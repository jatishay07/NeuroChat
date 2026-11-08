"""Connection lifecycle for the headset, shared by the portal and the extension.

States: idle → scanning → idle (with results) → connecting → streaming,
with error when something the user can fix goes wrong. While streaming, the
manager keeps the last few seconds of EEG, measures the real sample rate, and
labels each sensor's signal quality once a second.
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict
import time
from typing import Any

import numpy as np

from .backends import Backend
from .backends import BackendError
from .backends import DeviceInfo
from .quality import channel_quality

BUFFER_SECONDS = (
    180  # covers a paragraph visit and a 2-minute engagement calibration
)
QUALITY_SECONDS = 2
WAVE_SECONDS = 2  # the live waveform on the connect screen
WAVE_POINTS = 60
WAVE_INTERVAL = 0.25
POLL_INTERVAL = 0.1
STALL_SECONDS = 3.0  # no samples for this long while streaming → lost
FIRST_DATA_TIMEOUT = 10.0  # connected but nothing arrives → give up


class DeviceManager:
    def __init__(self, backend: Backend):
        self.backend = backend
        self._native: Backend | None = (
            None  # the usual backend while a browser headset stands in
        )
        self.state = "idle"
        self.error: str | None = None
        self.devices: list[DeviceInfo] = []
        self.device: DeviceInfo | None = None
        self.quality: list[str] = ["unknown"] * len(backend.channels)
        self.measured_srate: float | None = None
        n = int(BUFFER_SECONDS * backend.srate)
        self._buffer = np.zeros((len(backend.channels), n))
        self._times = np.zeros(
            n
        )  # time.monotonic() each sample arrived, for lining up with gaze
        self._filled = 0
        self._task: asyncio.Task | None = None
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    # ---- status and subscriptions --------------------------------------------
    def status(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "error": self.error,
            "devices": [asdict(d) for d in self.devices],
            "device": asdict(self.device) if self.device else None,
            "channels": self.backend.channels,
            "quality": self.quality,
            "srate": round(self.measured_srate, 1)
            if self.measured_srate
            else None,
            # The portal offers the fake headset only when that's what the
            # companion runs with.
            "simulated": getattr(
                self._native or self.backend, "simulated", False
            ),
            "wave": self.wave() if self.state == "streaming" else None,
        }

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=16)
        self._subscribers.add(q)
        q.put_nowait(self.status())
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _publish(self) -> None:
        snap = self.status()
        for q in list(self._subscribers):
            if q.full():
                q.get_nowait()  # drop the oldest; only the latest status matters
            q.put_nowait(snap)

    def _set(self, state: str, error: str | None = None) -> None:
        self.state, self.error = state, error
        self._publish()

    # ---- actions -------------------------------------------------------------
    async def scan(self, timeout: float = 5.0) -> list[DeviceInfo]:
        async with self._lock:
            if self.state in ("connecting", "streaming"):
                raise BackendError(
                    "Disconnect the current headset before scanning."
                )
            self._set("scanning")
            try:
                self.devices = await self.backend.scan(timeout)
            except BackendError as e:
                self._set("error", str(e))
                raise
            self._set(
                "idle",
                None
                if self.devices
                else "No headset found. Turn it on and keep it close.",
            )
            return self.devices

    async def connect(self, address: str) -> None:
        async with self._lock:
            if self.state in ("connecting", "streaming"):
                raise BackendError("Already connected. Disconnect first.")
            self.device = next(
                (d for d in self.devices if d.address == address),
                DeviceInfo("Muse", address),
            )
            self._set("connecting")
            try:
                await self.backend.connect(address)
            except BackendError as e:
                self.device = None
                self._set("error", str(e))
                raise
            self._filled = 0
            self.quality = ["unknown"] * len(self.backend.channels)
            self.measured_srate = None
            self._task = asyncio.create_task(self._pump())

    async def connect_browser(self, headset: Backend, name: str) -> None:
        """Stream from a headset the browser connected (Web Bluetooth) instead
        of the usual backend.
        """
        async with self._lock:
            if self.state in ("connecting", "streaming"):
                raise BackendError("Already connected. Disconnect first.")
            self._native, self.backend = self.backend, headset
            self.device = DeviceInfo(name, "browser")
            self.devices = []
            self._filled = 0
            self.quality = ["unknown"] * len(self.backend.channels)
            self.measured_srate = None
            self._set("connecting")
            self._task = asyncio.create_task(self._pump())

    async def detach(self, headset: Backend, error: str | None = None) -> None:
        """The browser's session ended: disconnect, or show what went wrong."""
        if self.backend is not headset:
            return  # already stopped (a disconnect, or the pump gave up)
        if error is None:
            await self.disconnect()
            return
        async with self._lock:
            await self._stop()
            self.device = None
            self._set("error", error)

    async def disconnect(self) -> None:
        async with self._lock:
            await self._stop()
            self.device = None
            self.quality = ["unknown"] * len(self.backend.channels)
            self.measured_srate = None
            self._set("idle")

    async def _stop(self) -> None:
        if self._task and self._task is not asyncio.current_task():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        await self.backend.disconnect()
        if self._native is not None:
            self.backend, self._native = self._native, None

    def window(self, seconds: float) -> np.ndarray:
        """The most recent `seconds` of EEG, channels × samples."""
        n = min(
            self._filled,
            int(seconds * self.backend.srate),
            self._buffer.shape[1],
        )
        return self._buffer[:, self._buffer.shape[1] - n :]

    def eeg_between(self, t0: float, t1: float) -> np.ndarray:
        """EEG that arrived between two time.monotonic() times, channels ×
        samples.
        """
        start = self._buffer.shape[1] - self._filled
        times = self._times[start:]
        keep = (times >= t0) & (times <= t1)
        return self._buffer[:, start:][:, keep]

    def samples_between(
        self, t0: float, t1: float
    ) -> tuple[np.ndarray, np.ndarray]:
        """Like eeg_between, with each sample's time.monotonic() arrival time:

        (times, channels × samples).
        Only samples after t0 (exclusive), so successive calls don't repeat one.
        """
        start = self._buffer.shape[1] - self._filled
        times = self._times[start:]
        keep = (times > t0) & (times <= t1)
        return times[keep].copy(), self._buffer[:, start:][:, keep].copy()

    def wave(self) -> list[list[float]]:
        """The last few seconds per channel, averaged down to WAVE_POINTS, mean
        removed, in µV.
        """
        w = self.window(WAVE_SECONDS)
        n = w.shape[1] // WAVE_POINTS * WAVE_POINTS
        if n == 0:
            return [[] for _ in self.backend.channels]
        w = w[:, -n:].reshape(len(w), WAVE_POINTS, -1).mean(axis=2)
        w -= w.mean(axis=1, keepdims=True)
        return np.round(w, 1).tolist()

    # ---- streaming loop ------------------------------------------------------
    async def _pump(self) -> None:
        started = last_data = last_quality = last_wave = time.monotonic()
        rate_t0, rate_n = None, 0
        try:
            while True:
                await asyncio.sleep(POLL_INTERVAL)
                now = time.monotonic()
                chunk = self.backend.read()
                if chunk.shape[1]:
                    self._append(chunk)
                    last_data = now
                    if rate_t0 is None:
                        rate_t0 = now
                        self._set("streaming")
                    else:
                        rate_n += chunk.shape[1]
                elif (
                    self.state == "connecting"
                    and now - started > FIRST_DATA_TIMEOUT
                ):
                    raise BackendError(
                        "Connected, but no EEG arrived. Try turning the headset off and on."
                    )
                elif (
                    self.state == "streaming"
                    and now - last_data > STALL_SECONDS
                ):
                    raise BackendError(
                        "Lost the headset signal. It may be out of range or out of battery."
                    )
                if self.state == "streaming" and now - last_quality >= 1.0:
                    last_quality = now
                    if rate_t0 is not None and now > rate_t0:
                        self.measured_srate = rate_n / (now - rate_t0)
                    self.quality = channel_quality(
                        self.window(QUALITY_SECONDS), self.backend.srate
                    )
                    self._publish()
                    last_wave = now
                elif (
                    self.state == "streaming"
                    and now - last_wave >= WAVE_INTERVAL
                ):
                    last_wave = now
                    self._publish()  # carries the live waveform
        except asyncio.CancelledError:
            raise
        except Exception as e:  # BackendError carries a user-facing message; anything else is a bug
            await self._stop()
            self.device = None
            self._set(
                "error",
                str(e)
                if isinstance(e, BackendError)
                else f"Unexpected error: {e}",
            )

    def _append(self, chunk: np.ndarray) -> None:
        n = min(chunk.shape[1], self._buffer.shape[1])
        self._buffer = np.roll(self._buffer, -n, axis=1)
        self._buffer[:, -n:] = chunk[:, -n:]
        # A chunk is what arrived since the last poll: spread its samples back
        # from now.
        self._times = np.roll(self._times, -n)
        self._times[-n:] = (
            time.monotonic() - np.arange(n - 1, -1, -1) / self.backend.srate
        )
        self._filled = min(self._filled + n, self._buffer.shape[1])
