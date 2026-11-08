"""Eye movements, blinks and jaw clenches from the Muse's own electrodes.

The forehead sensors (AF7, AF8) sit just above the eyes, so they pick up the
eye's own electric field (the electro-oculogram, EOG) far more strongly than
brain rhythms. The cornea is positive, so looking right raises AF8 and lowers
AF7: horizontal eye position follows AF8 − AF7. A blink is a same-sign bump on
both forehead sensors, which cancels out of that difference. A jaw clench is a
burst of fast muscle activity (30–100 Hz) behind the ears, on TP9 and TP10.

- Saccade: a quick step in AF8 − AF7, found where the level over the next 130 ms differs from the
  level over the previous 130 ms by more than the signal's usual wobble. Its size is that difference
  in µV, and in degrees once a per-person gain is known
  (`fit_gain`, from jumps of known size).
- Blink: a 50–500 ms bump on the AF7/AF8 average.
- Clench: 30–100 Hz power on TP9/TP10 well above its own median for at least 150 ms.

Everything works on channels × samples in µV, in the headset's order TP9, AF7,
AF8, TP10. Run `python -m companion.eyemove <recording>` to list what a file
contains.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
import json

import numpy as np
from scipy.signal import butter
from scipy.signal import find_peaks
from scipy.signal import iirnotch
from scipy.signal import sosfiltfilt
from scipy.signal import tf2sos

from .device.backends import EEG_CHANNELS

TP9, AF7, AF8, TP10 = (
    EEG_CHANNELS.index(c) for c in ("TP9", "AF7", "AF8", "TP10")
)

EOG_LOWPASS_HZ = 15.0  # saccade steps last 20–100 ms; nothing useful above this
STEP_GAP_MS = (
    20.0  # the movement itself, skipped either side of the moment tested
)
STEP_WINDOW_MS = 130.0  # levels before and after are averaged over this long
SACCADE_K = 5.0  # a step must clear this many robust SDs of the step signal
SACCADE_MIN_INTERVAL_MS = (
    150.0  # fixations last at least this long between saccades
)
BLINK_BAND_HZ = (0.5, 10.0)
BLINK_K = (
    5.0  # blink peaks stand this many robust SDs above the forehead average
)
BLINK_MIN_UV = 40.0
BLINK_WIDTH_MS = (50.0, 500.0)
BLINK_GUARD_MS = (
    100.0  # saccades this close to a blink are blink edges, not eye movements
)
EMG_BAND_HZ = (30.0, 100.0)
EMG_WINDOW_MS = 100.0
CLENCH_RATIO = 4.0  # clench = EMG envelope this many times its own median
CLENCH_MIN_MS = 150.0


@dataclass
class Saccade:
    onset: float  # seconds from the start of the recording
    offset: float
    step_uv: float  # AF8 − AF7 after minus before; positive = eyes moved right
    degrees: float | None = None  # signed, once a gain is known

    @property
    def direction(self) -> str:
        return "right" if self.step_uv > 0 else "left"


@dataclass
class Blink:
    t: float  # time of the peak, seconds
    height_uv: float
    width_ms: float


@dataclass
class Clench:
    start: float
    end: float
    ratio: float  # peak EMG envelope over its median


@dataclass
class EyeEvents:
    saccades: list[Saccade] = field(default_factory=list)
    blinks: list[Blink] = field(default_factory=list)
    clenches: list[Clench] = field(default_factory=list)
    seconds: float = 0.0

    def summary(self) -> dict:
        minutes = max(self.seconds / 60, 1e-9)
        return {
            "seconds": round(self.seconds, 1),
            "saccades": len(self.saccades),
            "blinks": len(self.blinks),
            "clenches": len(self.clenches),
            "blinks_per_minute": round(len(self.blinks) / minutes, 1),
        }


# ---- helpers -----------------------------------------------------------------


def _robust_sd(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if x.size == 0:
        return 0.0
    return float(1.4826 * np.median(np.abs(x - np.median(x))))


def _fill_gaps(x: np.ndarray) -> np.ndarray:
    """Linear interpolation over NaNs (dropped samples), per row."""
    x = np.array(x, dtype=float, copy=True)
    for row in np.atleast_2d(x):
        bad = ~np.isfinite(row)
        if bad.all():
            row[:] = 0.0
        elif bad.any():
            idx = np.arange(row.size)
            row[bad] = np.interp(idx[bad], idx[~bad], row[~bad])
    return x


def _filtfilt(sos: np.ndarray, x: np.ndarray) -> np.ndarray:
    pad = 3 * (2 * len(sos) + 1)
    if x.shape[-1] <= pad:
        return x - np.median(x, axis=-1, keepdims=True)
    return sosfiltfilt(sos, x, axis=-1)


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) index pairs of True runs, end exclusive."""
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    return list(
        zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1), strict=False)
    )


def heog(eeg: np.ndarray, srate: float) -> np.ndarray:
    """Horizontal eye position signal: AF8 − AF7, low-passed, in µV.

    Up = looking right.
    """
    x = _fill_gaps(np.asarray(eeg, dtype=float)[[AF8, AF7]])
    h = x[0] - x[1]
    sos = butter(4, EOG_LOWPASS_HZ, btype="lowpass", fs=srate, output="sos")
    return _filtfilt(sos, h - np.median(h))


def forehead(eeg: np.ndarray, srate: float) -> np.ndarray:
    """AF7/AF8 average, 0.5–10 Hz: where blinks show."""
    x = _fill_gaps(np.asarray(eeg, dtype=float)[[AF7, AF8]]).mean(axis=0)
    sos = butter(2, BLINK_BAND_HZ, btype="bandpass", fs=srate, output="sos")
    return _filtfilt(sos, x - np.median(x))


# ---- detectors ---------------------------------------------------------------


def detect_blinks(eeg: np.ndarray, srate: float) -> list[Blink]:
    v = forehead(eeg, srate)
    # Blinks point the same way every time; take the polarity with the bigger
    # tail.
    if np.percentile(v, 0.5) < 0 and abs(np.percentile(v, 0.5)) > abs(
        np.percentile(v, 99.5)
    ):
        v = -v
    sd = _robust_sd(v)
    height = max(BLINK_K * sd, BLINK_MIN_UV)
    lo, hi = (w * srate / 1000 for w in BLINK_WIDTH_MS)
    peaks, props = find_peaks(
        v,
        height=height,
        prominence=height,
        width=(lo / 2, hi),
        distance=int(0.2 * srate),
    )
    return [
        Blink(
            t=float(p / srate),
            height_uv=float(v[p]),
            width_ms=float(w / srate * 1000 * 2),
        )
        for p, w in zip(peaks, props["widths"], strict=False)
    ]


def step_signal(h: np.ndarray, srate: float) -> np.ndarray:
    """How much the eye signal stepped at each moment: mean of the next ~130 ms
    minus mean of the previous ~130 ms, skipping 20 ms either side for the
    movement itself. Brain rhythms average out over those windows while a
    saccade's step doesn't, which makes this far more sensitive than the
    signal's velocity.
    """
    g, w = (
        max(1, int(ms * srate / 1000)) for ms in (STEP_GAP_MS, STEP_WINDOW_MS)
    )
    c = np.concatenate([[0.0], np.cumsum(h)])
    n = h.size
    i = np.arange(n)
    a0, a1 = np.clip(i + g, 0, n), np.clip(i + g + w, 0, n)
    b0, b1 = np.clip(i - g - w, 0, n), np.clip(i - g, 0, n)
    after = (c[a1] - c[a0]) / np.maximum(a1 - a0, 1)
    before = (c[b1] - c[b0]) / np.maximum(b1 - b0, 1)
    d = after - before
    edge = g + w
    d[:edge] = 0
    d[n - edge :] = 0
    return d


def detect_saccades(
    eeg: np.ndarray,
    srate: float,
    blinks: list[Blink] | None = None,
    gain_uv_per_deg: float | None = None,
    k: float = SACCADE_K,
) -> list[Saccade]:
    """Horizontal saccades.

    Pass blinks to drop steps at a blink's edges (detected if not given).
    """
    h = heog(eeg, srate)
    d = step_signal(h, srate)
    sd = _robust_sd(d[d != 0])
    if sd == 0:
        return []
    if blinks is None:
        blinks = detect_blinks(eeg, srate)
    guard = BLINK_GUARD_MS / 1000
    out: list[Saccade] = []
    gap = STEP_GAP_MS / 1000
    for sign in (1, -1):
        peaks, _ = find_peaks(
            sign * d,
            height=k * sd,
            distance=int(SACCADE_MIN_INTERVAL_MS * srate / 1000),
        )
        for p in peaks:
            t = p / srate
            if any(abs(t - b.t) <= guard + b.width_ms / 2000 for b in blinks):
                continue
            step = float(d[p])
            out.append(
                Saccade(
                    onset=t - gap,
                    offset=t + gap,
                    step_uv=step,
                    degrees=step / gain_uv_per_deg if gain_uv_per_deg else None,
                )
            )
    out.sort(key=lambda s: s.onset)
    # A left step right after a right step of the same size is one wobble, not
    # two saccades: keep both (reading back and forth is real), but two
    # same-direction peaks this close are one movement.
    merged: list[Saccade] = []
    for sac in out:
        if (
            merged
            and sac.onset - merged[-1].onset < SACCADE_MIN_INTERVAL_MS / 1000
            and np.sign(sac.step_uv) == np.sign(merged[-1].step_uv)
        ):
            if abs(sac.step_uv) > abs(merged[-1].step_uv):
                merged[-1] = sac
            continue
        merged.append(sac)
    return merged


def detect_clenches(
    eeg: np.ndarray, srate: float, mains: float = 60.0
) -> list[Clench]:
    x = _fill_gaps(np.asarray(eeg, dtype=float)[[TP9, TP10]])
    hi = min(EMG_BAND_HZ[1], 0.45 * srate)
    sos = butter(
        4, (EMG_BAND_HZ[0], hi), btype="bandpass", fs=srate, output="sos"
    )
    for f in (mains, 2 * mains):
        if f < srate / 2:
            sos = np.vstack([sos, tf2sos(*iirnotch(f, 30.0, fs=srate))])
    emg = _filtfilt(sos, x - np.median(x, axis=1, keepdims=True))
    win = max(1, int(EMG_WINDOW_MS * srate / 1000))
    power = np.convolve((emg**2).mean(axis=0), np.ones(win) / win, mode="same")
    env = np.sqrt(power)
    base = float(np.median(env))
    if base <= 0:
        return []
    out = []
    for s, e in _runs(env > CLENCH_RATIO * base):
        if (e - s) / srate * 1000 >= CLENCH_MIN_MS:
            out.append(
                Clench(
                    start=s / srate,
                    end=e / srate,
                    ratio=float(env[s:e].max() / base),
                )
            )
    return out


def detect(
    eeg: np.ndarray, srate: float, gain_uv_per_deg: float | None = None
) -> EyeEvents:
    blinks = detect_blinks(eeg, srate)
    return EyeEvents(
        saccades=detect_saccades(eeg, srate, blinks, gain_uv_per_deg),
        blinks=blinks,
        clenches=detect_clenches(eeg, srate),
        seconds=np.asarray(eeg).shape[1] / srate,
    )


def fit_gain(steps_uv: np.ndarray, degrees: np.ndarray) -> float:
    """µV per degree from saccades of known size: least squares through the
    origin.
    """
    steps_uv, degrees = np.asarray(steps_uv, float), np.asarray(degrees, float)
    ok = np.isfinite(steps_uv) & np.isfinite(degrees) & (degrees != 0)
    if ok.sum() < 3:
        raise ValueError("need at least 3 saccades of known size to fit a gain")
    d, s = degrees[ok], steps_uv[ok]
    return float((d * s).sum() / (d * d).sum())


def main(argv: list[str] | None = None) -> None:
    from .recording import load_recording

    p = argparse.ArgumentParser(
        prog="python -m companion.eyemove", description=__doc__.split("\n")[0]
    )
    p.add_argument("recording", help="Muse recording (CSV, NPZ or XDF)")
    p.add_argument(
        "--gain",
        type=float,
        help="µV per degree, to report saccade sizes in degrees",
    )
    p.add_argument(
        "--events",
        action="store_true",
        help="list every event, not just the summary",
    )
    args = p.parse_args(argv)
    rec = load_recording(args.recording)
    ev = detect(rec.eeg, rec.srate, args.gain)
    out = ev.summary()
    if args.events:
        out["events"] = {
            "saccades": [asdict(s) for s in ev.saccades],
            "blinks": [asdict(b) for b in ev.blinks],
            "clenches": [asdict(c) for c in ev.clenches],
        }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
