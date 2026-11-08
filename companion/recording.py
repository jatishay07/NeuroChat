"""Read and write EEG recordings, so the engagement pipeline runs on files as
well as live.

Reads the formats a Muse recording usually comes in:
- CSV from Mind Monitor (RAW_TP9 … RAW_TP10, TimeStamp), muselsl / OpenMuse / BrainFlow exports
  (TP9, AF7, AF8, TP10, optionally with a timestamps column), or our own synthetic files;
- NPZ with eeg (channels × samples), srate and optionally channels;
- XDF from LabRecorder, if pyxdf is installed (the first stream with EEG in its name or type).
The sample rate comes from the timestamps when there are any, else from srate (default 256 Hz).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime
import os
from pathlib import Path
import time

import numpy as np

from .device.backends import BackendError
from .device.backends import DeviceInfo
from .device.backends import EEG_CHANNELS
from .device.backends import EEG_SRATE

TIME_COLUMNS = ("timestamps", "timestamp", "time", "lsl_time", "unix_time")


@dataclass
class Recording:
    eeg: np.ndarray  # channels × samples, µV
    srate: float
    channels: list[str]


def _seconds(values: list[str]) -> np.ndarray | None:
    try:
        return np.array([float(v) for v in values])
    except ValueError:
        pass
    try:  # Mind Monitor: "2024-05-01 10:00:00.123"
        return np.array(
            [datetime.fromisoformat(v.strip()).timestamp() for v in values]
        )
    except ValueError:
        return None


def _rate(times: np.ndarray | None, fallback: float) -> float:
    if times is None or len(times) < 2:
        return fallback
    if times[-1] <= times[0]:
        return fallback
    # Muse timestamps come in 12-sample bursts, so use the whole span rather
    # than single steps.
    rate = (len(times) - 1) / (times[-1] - times[0])
    return float(rate) if 50 <= rate <= 2000 else fallback


def _find(header: list[str], channel: str) -> int | None:
    names = [h.strip().lower() for h in header]
    for candidate in (
        channel,
        f"raw_{channel}",
        f"eeg_{channel}",
        f"muse_eeg_{channel}",
    ):
        if candidate.lower() in names:
            return names.index(candidate.lower())
    return next(
        (i for i, n in enumerate(names) if n.endswith(channel.lower())), None
    )


def load_csv(path: Path, srate: float | None = None) -> Recording:
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        raise ValueError(f"{path} is empty.")
    header, body = rows[0], rows[1:]
    cols = {c: _find(header, c) for c in EEG_CHANNELS}
    if any(i is None for i in cols.values()):
        missing = ", ".join(c for c, i in cols.items() if i is None)
        raise ValueError(
            f"{path.name} has no column for {missing}. Expected columns like TP9, AF7, AF8, TP10."
        )
    tcol = next(
        (i for i, h in enumerate(header) if h.strip().lower() in TIME_COLUMNS),
        None,
    )
    eeg, times = [], []
    for row in body:  # Mind Monitor interleaves blank "Elements" rows (blinks, markers): skip them
        try:
            sample = [float(row[i]) for i in cols.values()]
        except (ValueError, IndexError):
            continue
        if not all(np.isfinite(sample)):
            continue
        eeg.append(sample)
        if tcol is not None and tcol < len(row):
            times.append(row[tcol])
    if not eeg:
        raise ValueError(f"{path.name} has no EEG samples.")
    t = _seconds(times) if len(times) == len(eeg) else None
    return Recording(
        np.array(eeg).T, srate or _rate(t, EEG_SRATE), list(EEG_CHANNELS)
    )


def load_recording(path: str | Path, srate: float | None = None) -> Recording:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".npz":
        z = np.load(path, allow_pickle=False)
        eeg = np.asarray(z["eeg"], dtype=float)
        channels = (
            [str(c) for c in z["channels"]]
            if "channels" in z
            else list(EEG_CHANNELS)[: eeg.shape[0]]
        )
        return Recording(
            eeg,
            float(srate or (z["srate"] if "srate" in z else EEG_SRATE)),
            channels,
        )
    if suffix == ".xdf":
        try:
            import pyxdf
        except ImportError as e:
            raise ValueError(
                "Reading XDF needs pyxdf: pip install pyxdf"
            ) from e
        streams, _ = pyxdf.load_xdf(str(path))
        for s in streams:
            info = s["info"]
            if "EEG" in (info["name"][0] + info["type"][0]).upper():
                data = np.asarray(s["time_series"], dtype=float).T
                return Recording(
                    data[: len(EEG_CHANNELS)],
                    float(
                        srate or _rate(np.asarray(s["time_stamps"]), EEG_SRATE)
                    ),
                    list(EEG_CHANNELS),
                )
        raise ValueError(f"{path.name} has no EEG stream.")
    return load_csv(path, srate)


def save_csv(
    path: str | Path,
    eeg: np.ndarray,
    srate: float,
    channels: list[str] = EEG_CHANNELS,
) -> None:
    """muselsl-style CSV: timestamps, TP9, AF7, AF8, TP10."""
    t = np.arange(eeg.shape[1]) / srate
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamps", *channels])
        for i in range(eeg.shape[1]):
            w.writerow([f"{t[i]:.6f}", *(f"{v:.3f}" for v in eeg[:, i])])


class RecordingBackend:
    """Plays recordings back as if a headset were streaming them, in real time
    and looping, so the app and the signals page run on real EEG without a
    headset. parts is [(label, Recording)], played one after another; the label
    of the part playing shows as the device name.
    """

    channels = EEG_CHANNELS
    simulated = True
    synthetic_eeg = True  # recorded from a person, so the tutor may use it
    address = "REPLAY"

    def __init__(self, parts: list[tuple[str, Recording]]):
        if not parts:
            raise ValueError("Nothing to play.")
        rates = {round(r.srate) for _, r in parts}
        if len(rates) != 1:
            raise ValueError("All recordings must share one sample rate.")
        self.srate = float(parts[0][1].srate)
        self.data = np.concatenate(
            [r.eeg[: len(self.channels)] for _, r in parts], axis=1
        )
        self.parts, edge = [], 0
        for label, r in parts:
            self.parts.append((edge, edge + r.eeg.shape[1], label))
            edge += r.eeg.shape[1]
        self.calibration: tuple[float, float] | None = (
            None  # (E_min, E_max) to use, if known
        )
        self._t0: float | None = None
        self._sent = 0

    def playing(self) -> str | None:
        """The label of the part being played now."""
        if self._t0 is None:
            return None
        pos = self._sent % self.data.shape[1]
        return next(
            label for start, end, label in self.parts if start <= pos < end
        )

    async def scan(self, timeout: float) -> list[DeviceInfo]:
        return [DeviceInfo(name="Recorded EEG (replay)", address=self.address)]

    async def connect(self, address: str) -> None:
        if address != self.address:
            raise BackendError(f"No recording at {address}.")
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
        idx = (self._sent + np.arange(n)) % self.data.shape[1]
        self._sent = due
        return self.data[:, idx]


# --replay bird: which of subject A's minutes to play for each band. Scored with
# the calibration below, the second neutral minute reads low most of the time,
# the second concentrating minute moderate (wobbling into high), and the first
# concentrating minute high throughout. The "relaxed" minutes (eyes closed,
# calm music) are left out: this index reads them as the most engaged of all.
BIRD_PARTS = {
    "low": "neutral-2",
    "moderate": "concentrating-2",
    "high": "concentrating-1",
}


def replay_backend(spec: str) -> RecordingBackend:
    """--replay: "bird" plays one person from the public Bird et al. Muse set,
    a minute that reads low, then one that reads moderate, then one that reads
    high (downloaded into data/bird the first time); "bird:low",
    "bird:moderate" or "bird:high" loops just that minute. Anything else is a
    list of recording files separated by commas.
    """
    if spec == "bird" or spec.startswith("bird:"):
        from .engagement import calibration_bound
        from .realdata import fetch

        bands = (
            spec[5:].split(",")
            if spec.startswith("bird:")
            else list(BIRD_PARTS)
        )
        unknown = [b for b in bands if b not in BIRD_PARTS]
        if unknown:
            raise ValueError(
                f"--replay bird:{','.join(unknown)}: choose from "
                + ", ".join(BIRD_PARTS)
            )
        folder = Path(os.environ.get("NEUROCHAT_BIRD_DATA", "data/bird"))
        fetch(folder)  # skips files already there
        backend = RecordingBackend(
            [
                (
                    f"Bird et al. subject A, {BIRD_PARTS[b].split('-')[0]} (reads {b})",
                    load_recording(folder / f"subjecta-{BIRD_PARTS[b]}.csv"),
                )
                for b in bands
            ]
        )
        # Calibrated the paper's way: E_min over the person's neutral minute,
        # E_max over a concentrating one.
        neutral, focused = (
            load_recording(folder / f"subjecta-{s}-2.csv")
            for s in ("neutral", "concentrating")
        )
        backend.calibration = (
            calibration_bound(neutral.eeg, neutral.srate, "relax"),
            calibration_bound(focused.eeg, focused.srate, "task"),
        )
        return backend
    return RecordingBackend(
        [(Path(p).stem, load_recording(p)) for p in spec.split(",")]
    )
