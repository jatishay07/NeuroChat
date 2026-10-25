"""Ways of reaching a headset.

`MuseBackend` talks to a real Muse S Athena: it scans over Bluetooth LE with bleak,
starts OpenMuse to stream the headset onto Lab Streaming Layer (LSL), and reads
the EEG stream back with pylsl. `SimulatedBackend` produces believable fake EEG
so the rest of the app can be built and tested without a headset.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Protocol

import numpy as np

EEG_CHANNELS = ["TP9", "AF7", "AF8", "TP10"]
EEG_SRATE = 256.0


@dataclass(frozen=True)
class DeviceInfo:
    name: str
    address: str
    rssi: int | None = None


class BackendError(RuntimeError):
    """A problem the user can act on; the message is shown in the portal."""


class Backend(Protocol):
    channels: list[str]
    srate: float

    async def scan(self, timeout: float) -> list[DeviceInfo]: ...
    async def connect(self, address: str) -> None: ...
    async def disconnect(self) -> None: ...
    def read(self) -> np.ndarray:
        """New EEG samples since the last call, channels × samples, in µV."""
        ...


class SimulatedBackend:
    """Fake Athena: four channels of 1/f-ish noise with an alpha rhythm.

    `bad_channel` makes one sensor flat, to exercise the signal check.
    """

    channels = EEG_CHANNELS
    srate = EEG_SRATE

    def __init__(self, bad_channel: str | None = None, seed: int = 7):
        self.bad_channel = bad_channel
        self._rng = np.random.default_rng(seed)
        self._t0: float | None = None
        self._sent = 0

    async def scan(self, timeout: float) -> list[DeviceInfo]:
        await asyncio.sleep(min(timeout, 0.2))
        return [DeviceInfo(name="Muse-SIM (simulated)", address="SIM-0001", rssi=-50)]

    async def connect(self, address: str) -> None:
        if address != "SIM-0001":
            raise BackendError(f"No simulated headset at {address}.")
        await asyncio.sleep(0.1)
        self._t0 = time.monotonic()
        self._sent = 0

    async def disconnect(self) -> None:
        self._t0 = None

    def read(self) -> np.ndarray:
        if self._t0 is None:
            return np.empty((len(self.channels), 0))
        due = int((time.monotonic() - self._t0) * self.srate)
        n = due - self._sent
        if n <= 0:
            return np.empty((len(self.channels), 0))
        t = (self._sent + np.arange(n)) / self.srate
        self._sent = due
        alpha = 8.0 * np.sin(2 * np.pi * 10.0 * t)
        noise = np.cumsum(self._rng.normal(0, 1.5, (len(self.channels), n)), axis=1) * 0.2
        data = 800.0 + alpha + noise + self._rng.normal(0, 4.0, (len(self.channels), n))
        if self.bad_channel in self.channels:
            data[self.channels.index(self.bad_channel)] = 800.0
        return data


class MuseBackend:
    """Real Muse S Athena through bleak (scan), OpenMuse (stream) and pylsl (read).

    Needs the `hardware` extras: pip install -e ".[hardware]".
    """

    channels = EEG_CHANNELS
    srate = EEG_SRATE
    STREAM_TIMEOUT = 20.0

    def __init__(self):
        self._proc: subprocess.Popen | None = None
        self._inlet = None
        self._picks: list[int] = list(range(len(self.channels)))

    async def scan(self, timeout: float) -> list[DeviceInfo]:
        try:
            from bleak import BleakScanner
        except ImportError as e:
            raise BackendError('Bluetooth support is not installed. Run: pip install -e ".[hardware]"') from e
        try:
            found = await BleakScanner.discover(timeout=timeout, return_adv=True)
        except Exception as e:  # bleak raises platform-specific errors when Bluetooth is off
            raise BackendError(f"Bluetooth scan failed: {e}. Check that Bluetooth is on.") from e
        devices = []
        for address, (dev, adv) in found.items():
            name = dev.name or adv.local_name or ""
            if name.lower().startswith("muse"):
                devices.append(DeviceInfo(name=name, address=address, rssi=adv.rssi))
        return sorted(devices, key=lambda d: -(d.rssi or -999))

    async def connect(self, address: str) -> None:
        # Look next to this Python too, so it's found even when the virtualenv isn't activated.
        exe = shutil.which("OpenMuse") or shutil.which("OpenMuse", path=os.path.dirname(sys.executable))
        if exe is None:
            raise BackendError('OpenMuse is not installed. Run: pip install -e ".[hardware]"')
        try:
            from pylsl import StreamInlet, resolve_streams
        except ImportError as e:
            raise BackendError('pylsl is not installed. Run: pip install -e ".[hardware]"') from e
        self._proc = subprocess.Popen(
            [exe, "stream", "--address", address],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        deadline = time.monotonic() + self.STREAM_TIMEOUT
        while time.monotonic() < deadline:
            if self._proc.poll() is not None:
                out = (self._proc.stdout.read() if self._proc.stdout else "").strip()
                raise BackendError(f"OpenMuse stopped while connecting. {out[-300:]}")
            # OpenMuse names its EEG stream Muse_EEG (or "Muse-EEG (<address>)" with several headsets).
            streams = await asyncio.to_thread(resolve_streams, 1.0)
            eeg = [s for s in streams if s.name().startswith("Muse") and "EEG" in s.name()]
            if eeg:
                self._inlet = StreamInlet(eeg[0], max_buflen=10)
                self._picks = self._pick_eeg_channels(self._inlet)
                return
        await self.disconnect()
        raise BackendError("The headset didn't start streaming. Make sure it's on and not connected to the Muse app.")

    def _pick_eeg_channels(self, inlet) -> list[int]:
        """Find TP9, AF7, AF8 and TP10 among the stream's channels (the Athena also sends aux channels)."""
        try:
            ch = inlet.info().desc().child("channels").child("channel")
            labels = []
            while not ch.empty():
                labels.append(ch.child_value("label"))
                ch = ch.next_sibling()
            return [labels.index(c) for c in self.channels]
        except Exception:  # missing channel metadata or labels: fall back to the first four
            return list(range(len(self.channels)))

    async def disconnect(self) -> None:
        self._inlet = None
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                await asyncio.to_thread(self._proc.wait, 5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None

    def read(self) -> np.ndarray:
        if self._inlet is None:
            return np.empty((len(self.channels), 0))
        if self._proc is not None and self._proc.poll() is not None:
            raise BackendError("The headset stream stopped. It may be out of range or out of battery.")
        chunk, _ = self._inlet.pull_chunk(timeout=0.0)
        if not chunk:
            return np.empty((len(self.channels), 0))
        return np.asarray(chunk, dtype=float).T[self._picks]
