"""Data for the eye-movement detectors: synthetic recordings with known events, the Afonso & Heinrichs
Muse S eye-tracking dataset, and scoring of detected saccades against known jumps.

Afonso & Heinrichs 2025, "Consumer-grade EEG-based Eye Tracking" (arXiv 2503.14322): 113 people on a
Muse S following a dot on screen, with a webcam eye tracker alongside. Data on Zenodo (record
14860668, CC BY 4.0); `csv_raw.zip` holds one CSV per recording with columns
Timestamp, EEG_TP9, EEG_AF7, EEG_AF8, EEG_TP10, Gaze_x, Gaze_y, Stimulus_x, Stimulus_y.
Gaze and stimulus are in mm from the screen centre; missing EEG samples are written as 0.
The files are downloaded by the user and never committed.
"""
from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfiltfilt

from .device.backends import EEG_CHANNELS, EEG_SRATE
from .eyemove import AF7, AF8, TP9, TP10, Saccade
from .synthetic import synthetic_eeg

VIEW_DISTANCE_MM = 600.0       # the dataset's viewing distance (about 60 cm)
JUMP_MIN_MM = 5.0              # stimulus moves smaller than this aren't jumps
MATCH_WINDOW_S = (0.05, 0.7)   # a detected saccade answers a jump 50–700 ms after it


# ---- synthetic -----------------------------------------------------------------------------------

@dataclass
class SyntheticEyes:
    eeg: np.ndarray
    srate: float
    jumps: list[tuple[float, float]] = field(default_factory=list)   # (time s, signed degrees)
    blinks: list[float] = field(default_factory=list)
    clenches: list[tuple[float, float]] = field(default_factory=list)


def synthetic_eyes(seconds: float = 60.0, srate: float = EEG_SRATE, seed: int = 0,
                   jumps: list[tuple[float, float]] | None = None, blinks: list[float] | None = None,
                   clenches: list[tuple[float, float]] | None = None, gain_uv_per_deg: float = 4.0,
                   drift_uv: float = 20.0) -> SyntheticEyes:
    """Background EEG plus eye steps, blinks and clenches at known times.

    Each jump moves the eyes by the given degrees in ~40 ms; the eye field adds +gain/2 per degree to
    AF8 and −gain/2 to AF7 (so AF8 − AF7 moves by gain per degree). Blinks are 300 ms bumps on both
    forehead sensors. Clenches are 30–100 Hz bursts on TP9/TP10. A slow random drift stands in for
    dry-electrode wander."""
    rng = np.random.default_rng(seed)
    n = int(round(seconds * srate))
    t = np.arange(n) / srate
    x = synthetic_eeg(0.5, seconds, srate=srate, seed=seed, blinks_per_minute=0)
    if jumps is None:
        times = np.arange(2.0, seconds - 2.0, 1.5)
        jumps = [(float(tt + rng.uniform(-0.2, 0.2)), float(rng.choice([-1, 1]) * rng.uniform(3, 20)))
                 for tt in times]
    blinks = blinks if blinks is not None else []
    clenches = clenches if clenches is not None else []
    position = np.zeros(n)
    rise = 0.04
    for tj, deg in jumps:
        position += deg * np.clip((t - tj) / rise, 0, 1)
    eye = gain_uv_per_deg / 2 * position
    x[AF8] += eye
    x[AF7] -= eye
    walk = np.cumsum(rng.normal(size=(len(EEG_CHANNELS), n)), axis=1)
    walk -= walk.mean(axis=1, keepdims=True)
    walk *= drift_uv / max(walk.std(), 1e-9)
    x += sosfiltfilt(butter(2, 0.2, btype="lowpass", fs=srate, output="sos"), walk, axis=1)
    width = int(0.3 * srate)
    bump = np.hanning(width)
    for tb in blinks:
        i = int(tb * srate) - width // 2
        if 0 <= i and i + width <= n:
            size = rng.uniform(150, 300)
            for ch, g in ((TP9, 0.1), (AF7, 1.0), (AF8, 1.0), (TP10, 0.1)):
                x[ch, i:i + width] += g * size * bump
    sos = butter(4, (30, min(100, 0.45 * srate)), btype="bandpass", fs=srate, output="sos")
    for t0, t1 in clenches:
        i0, i1 = int(t0 * srate), int(t1 * srate)
        burst = sosfiltfilt(sos, rng.normal(size=(2, i1 - i0)), axis=1) * 60.0
        x[[TP9, TP10], i0:i1] += burst * np.hanning(i1 - i0)[None, :] ** 0.25
    return SyntheticEyes(eeg=x, srate=srate, jumps=jumps, blinks=blinks, clenches=clenches)


# ---- Afonso & Heinrichs dataset ------------------------------------------------------------------

@dataclass
class TrackingRecording:
    name: str
    task: str                  # e.g. level-1-saccades
    eeg: np.ndarray            # 4 × samples, µV, order TP9, AF7, AF8, TP10; NaN where missing
    srate: float
    t: np.ndarray              # seconds from the first sample
    gaze_mm: np.ndarray        # 2 × samples, webcam gaze, mm from screen centre
    stim_mm: np.ndarray        # 2 × samples, dot position


def mm_to_deg(mm: np.ndarray | float, distance_mm: float = VIEW_DISTANCE_MM) -> np.ndarray | float:
    return np.degrees(np.arctan(np.asarray(mm, float) / distance_mm))


def load_tracking_csv(path: str | Path) -> TrackingRecording:
    path = Path(path)
    with path.open(newline="") as f:
        reader = csv.reader(f)
        header = [h.strip() for h in next(reader)]
        rows = np.array([[float(v) if v not in ("", "nan") else math.nan for v in r] for r in reader if r])
    col = {h: i for i, h in enumerate(header)}
    need = ["Timestamp", *(f"EEG_{c}" for c in EEG_CHANNELS), "Stimulus_x", "Stimulus_y"]
    missing = [c for c in need if c not in col]
    if missing:
        raise ValueError(f"{path.name}: missing columns {missing}")
    eeg = np.stack([rows[:, col[f"EEG_{c}"]] for c in EEG_CHANNELS])
    eeg[eeg == 0] = np.nan
    ts = rows[:, col["Timestamp"]]
    t = ts - ts[0]
    srate = (len(ts) - 1) / (ts[-1] - ts[0]) if ts[-1] > ts[0] else EEG_SRATE
    if not 200 <= srate <= 300:
        srate = EEG_SRATE
    gaze = np.stack([rows[:, col.get("Gaze_x", col["Stimulus_x"])], rows[:, col.get("Gaze_y", col["Stimulus_y"])]])
    stim = np.stack([rows[:, col["Stimulus_x"]], rows[:, col["Stimulus_y"]]])
    m = re.search(r"level-\d-(saccades|smooth)", path.name)
    return TrackingRecording(name=path.stem, task=m.group(0) if m else "unknown", eeg=eeg,
                             srate=float(srate), t=t, gaze_mm=gaze, stim_mm=stim)


def find_tracking_files(folder: str | Path, task: str = "saccades") -> list[Path]:
    return sorted(p for p in Path(folder).rglob("*.csv") if task in p.name)


def stimulus_jumps(rec: TrackingRecording, min_mm: float = JUMP_MIN_MM) -> list[tuple[float, float, float]]:
    """(time s, horizontal degrees, vertical degrees) for every jump of the dot."""
    sx, sy = rec.stim_mm
    dx, dy = np.diff(sx), np.diff(sy)
    idx = np.flatnonzero(np.hypot(dx, dy) >= min_mm)
    out = []
    for i in idx:
        before = (sx[i], sy[i])
        after = (sx[i + 1], sy[i + 1])
        out.append((float(rec.t[i + 1]),
                    float(mm_to_deg(after[0]) - mm_to_deg(before[0])),
                    float(mm_to_deg(after[1]) - mm_to_deg(before[1]))))
    return out


# ---- scoring -------------------------------------------------------------------------------------

@dataclass
class Match:
    jump_t: float
    jump_deg: float            # signed horizontal size
    saccade: Saccade | None


@dataclass
class Score:
    matches: list[Match]
    false_alarms: int
    minutes: float

    def by_size(self, edges: tuple[float, ...] = (0, 5, 10, 20, 90)) -> list[dict]:
        rows = []
        for lo, hi in zip(edges[:-1], edges[1:]):
            ms = [m for m in self.matches if lo <= abs(m.jump_deg) < hi]
            hits = [m for m in ms if m.saccade is not None]
            right_way = [m for m in hits if np.sign(m.saccade.step_uv) == np.sign(m.jump_deg)]
            rows.append({"size_deg": f"{lo}-{hi}", "jumps": len(ms), "hits": len(hits),
                         "hit_rate": round(len(hits) / len(ms), 3) if ms else None,
                         "right_direction": round(len(right_way) / len(hits), 3) if hits else None})
        return rows

    @property
    def false_alarms_per_minute(self) -> float:
        return self.false_alarms / self.minutes if self.minutes else 0.0


def score_saccades(saccades: list[Saccade], jumps: list[tuple[float, float]], seconds: float,
                   min_deg: float = 1.0, window: tuple[float, float] = MATCH_WINDOW_S) -> Score:
    """Match each horizontal jump (time, signed degrees) of at least min_deg to the first unused saccade
    starting inside the window after it. Saccades matching no jump are false alarms; saccades after
    jumps smaller than min_deg (vertical moves, tiny corrections) are neither."""
    used: set[int] = set()
    matches = []
    for tj, deg in sorted(jumps):
        if abs(deg) < min_deg:
            continue
        hit = None
        for i, s in enumerate(saccades):
            if i not in used and tj + window[0] <= s.onset <= tj + window[1]:
                hit = s
                used.add(i)
                break
        matches.append(Match(jump_t=tj, jump_deg=deg, saccade=hit))
    excused = {i for i, s in enumerate(saccades)
               if any(tj + window[0] <= s.onset <= tj + window[1] for tj, _ in jumps)}
    false_alarms = sum(1 for i in range(len(saccades)) if i not in used and i not in excused)
    return Score(matches=matches, false_alarms=false_alarms, minutes=seconds / 60)
