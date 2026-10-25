"""A headset the browser connected with Web Bluetooth.

The portal talks to the Muse S Athena itself (Chrome and Edge can, on macOS, Windows and
Android) and forwards the raw Bluetooth packets over /ws/headset. This decodes them with
OpenMuse's parser. It's how the headset works when the companion runs in Docker, which
can't reach Bluetooth, and it needs no OpenMuse, bleak or LSL install.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from .athena_decode import parse_message
from .backends import EEG_CHANNELS, EEG_SRATE, BackendError, DeviceInfo

# The Athena sends the 4 EEG sensors first, then aux channels.
N_EEG = len(EEG_CHANNELS)
MAX_PENDING = int(EEG_SRATE * 10)  # drop the oldest if nothing reads for 10 s


class BrowserHeadset:
    """Implements the Backend protocol for one Web Bluetooth session; the browser feeds it."""

    channels = EEG_CHANNELS
    srate = EEG_SRATE
    simulated = False

    def __init__(self):
        self._pending: list[np.ndarray] = []
        self._n_pending = 0
        self.closed = False

    def feed(self, packets: list) -> None:
        """Decode [uuid, hex] pairs, one per Bluetooth notification, in arrival order."""
        ts = datetime.now(timezone.utc).isoformat()
        for item in packets:
            try:
                uuid, hexdata = item
                eeg = parse_message(f"{ts}\t{uuid}\t{hexdata}")["EEG"]
            except (TypeError, ValueError):
                continue  # one bad packet shouldn't end the session
            eeg.sort(key=lambda s: (s["pkt_time_raw"], s["pkt_index"], s["subpkt_index"] or 0))
            for sub in eeg:
                chunk = np.asarray(sub["data"], dtype=float)[:, :N_EEG].T  # channels × samples
                self._pending.append(chunk)
                self._n_pending += chunk.shape[1]
        while self._n_pending > MAX_PENDING and self._pending:
            self._n_pending -= self._pending.pop(0).shape[1]

    async def scan(self, timeout: float) -> list[DeviceInfo]:
        return []

    async def connect(self, address: str) -> None:
        pass

    async def disconnect(self) -> None:
        self.closed = True

    def read(self) -> np.ndarray:
        if self.closed:
            raise BackendError("The browser lost the headset.")
        if not self._pending:
            return np.empty((N_EEG, 0))
        out = np.concatenate(self._pending, axis=1)
        self._pending, self._n_pending = [], 0
        return out
