"""Read and write EEG recordings, so the engagement pipeline runs on files as well as live.

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
from pathlib import Path

import numpy as np

from .device.backends import EEG_CHANNELS, EEG_SRATE

TIME_COLUMNS = ("timestamps", "timestamp", "time", "lsl_time", "unix_time")


@dataclass
class Recording:
    eeg: np.ndarray          # channels × samples, µV
    srate: float
    channels: list[str]


def _seconds(values: list[str]) -> np.ndarray | None:
    try:
        return np.array([float(v) for v in values])
    except ValueError:
        pass
    try:  # Mind Monitor: "2024-05-01 10:00:00.123"
        return np.array([datetime.fromisoformat(v.strip()).timestamp() for v in values])
    except ValueError:
        return None


def _rate(times: np.ndarray | None, fallback: float) -> float:
    if times is None or len(times) < 2:
        return fallback
    if times[-1] <= times[0]:
        return fallback
    # Muse timestamps come in 12-sample bursts, so use the whole span rather than single steps.
    rate = (len(times) - 1) / (times[-1] - times[0])
    return float(rate) if 50 <= rate <= 2000 else fallback


def _find(header: list[str], channel: str) -> int | None:
    names = [h.strip().lower() for h in header]
    for candidate in (channel, f"raw_{channel}", f"eeg_{channel}", f"muse_eeg_{channel}"):
        if candidate.lower() in names:
            return names.index(candidate.lower())
    return next((i for i, n in enumerate(names) if n.endswith(channel.lower())), None)


def load_csv(path: Path, srate: float | None = None) -> Recording:
    with open(path, newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        raise ValueError(f"{path} is empty.")
    header, body = rows[0], rows[1:]
    cols = {c: _find(header, c) for c in EEG_CHANNELS}
    if any(i is None for i in cols.values()):
        missing = ", ".join(c for c, i in cols.items() if i is None)
        raise ValueError(f"{path.name} has no column for {missing}. Expected columns like TP9, AF7, AF8, TP10.")
    tcol = next((i for i, h in enumerate(header) if h.strip().lower() in TIME_COLUMNS), None)
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
    return Recording(np.array(eeg).T, srate or _rate(t, EEG_SRATE), list(EEG_CHANNELS))


def load_recording(path: str | Path, srate: float | None = None) -> Recording:
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".npz":
        z = np.load(path, allow_pickle=False)
        eeg = np.asarray(z["eeg"], dtype=float)
        channels = [str(c) for c in z["channels"]] if "channels" in z else list(EEG_CHANNELS)[: eeg.shape[0]]
        return Recording(eeg, float(srate or (z["srate"] if "srate" in z else EEG_SRATE)), channels)
    if suffix == ".xdf":
        try:
            import pyxdf
        except ImportError as e:
            raise ValueError("Reading XDF needs pyxdf: pip install pyxdf") from e
        streams, _ = pyxdf.load_xdf(str(path))
        for s in streams:
            info = s["info"]
            if "EEG" in (info["name"][0] + info["type"][0]).upper():
                data = np.asarray(s["time_series"], dtype=float).T
                return Recording(data[: len(EEG_CHANNELS)], float(srate or _rate(np.asarray(s["time_stamps"]), EEG_SRATE)),
                                 list(EEG_CHANNELS))
        raise ValueError(f"{path.name} has no EEG stream.")
    return load_csv(path, srate)


def save_csv(path: str | Path, eeg: np.ndarray, srate: float, channels: list[str] = EEG_CHANNELS) -> None:
    """muselsl-style CSV: timestamps, TP9, AF7, AF8, TP10."""
    t = np.arange(eeg.shape[1]) / srate
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamps", *channels])
        for i in range(eeg.shape[1]):
            w.writerow([f"{t[i]:.6f}", *(f"{v:.3f}" for v in eeg[:, i])])
