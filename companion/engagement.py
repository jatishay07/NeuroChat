"""The NeuroChat kernel: EEG engagement index, calibration, buckets, and what the tutor is told.

Follows the NeuroChat paper (Baradari et al., arXiv 2503.07599, §3.2):
- 1–30 Hz band-pass and a mains notch;
- 1-second epochs every 250 ms, band power from each epoch's FFT;
- engagement E = β / (α + θ) (Pope et al. 1995) with θ 4–7 Hz, α 7–11 Hz, β 11–20 Hz (§3.2.3;
  §2.1.2 quotes the textbook 4–8 / 8–12 / 13–30, we follow the implementation section);
- band powers averaged over a 15-second window that moves forward every second;
- per-person calibration: E_min is the lowest score during ~2 min of relaxing, E_max the highest
  during ~2 min of a word-chain task, both on a 10-second window, and
  E_norm = (E − E_min) / (E_max − E_min), clipped to 0–1.

The paper gives the model the raw 0–1 number and no fixed rules. We add buckets on top: the
normalized score is cut into three bands, each with concrete instructions for the tutor, so a
small local model (Qwen 3.5 4B) gets something it can act on rather than a bare number.

Run `python -m companion.engagement --help` to make synthetic recordings or score a real one.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
from scipy.signal import butter, iirnotch, sosfilt, sosfiltfilt, tf2sos

THETA, ALPHA, BETA = (4.0, 7.0), (7.0, 11.0), (11.0, 20.0)
BANDPASS = (1.0, 30.0)
MAINS_HZ = 60.0             # the paper's notch; pass 50 for European mains
EPOCH_SECONDS = 1.0
EPOCH_STEP_SECONDS = 0.25
WINDOW_SECONDS = 15.0       # live score: band powers averaged over the last 15 s
CALIBRATION_WINDOW_SECONDS = 10.0
SCORE_STEP_SECONDS = 1.0    # the live score updates once a second
ARTIFACT_UV = 200.0         # an epoch swinging more than this peak to peak (blink, jaw, motion) is dropped
FLAT_UV = 0.5               # a channel this still isn't touching skin
MIN_SESSION_SECONDS = 30.0  # uncalibrated: need this much of the reading to judge against
SESSION_SECONDS = 180.0     # ...and judge against at most this much (the headset buffer's length)


# ---- signal → engagement index --------------------------------------------------------------

def preprocess(eeg: np.ndarray, srate: float, mains: float = MAINS_HZ) -> np.ndarray:
    """Band-pass 1–30 Hz and notch the mains frequency. eeg is channels × samples in µV."""
    x = np.asarray(eeg, dtype=float)
    x = x - x.mean(axis=1, keepdims=True)
    sos = butter(4, BANDPASS, btype="bandpass", fs=srate, output="sos")
    if mains < srate / 2:
        sos = np.vstack([sos, tf2sos(*iirnotch(mains, 30.0, fs=srate))])
    # Zero-phase where there's room for it; very short snippets fall back to a causal pass.
    return sosfiltfilt(sos, x, axis=1) if x.shape[1] > 3 * (2 * len(sos) + 1) else sosfilt(sos, x, axis=1)


def epoch_band_powers(eeg: np.ndarray, srate: float, mains: float = MAINS_HZ) -> tuple[np.ndarray, np.ndarray]:
    """Band powers of each 1 s epoch, stepping 250 ms. Returns (end time of each epoch in seconds
    from the start, powers epochs × channels × [θ, α, β]); epochs with artifacts on a channel are NaN there."""
    n_win, n_step = int(round(EPOCH_SECONDS * srate)), int(round(EPOCH_STEP_SECONDS * srate))
    if eeg.ndim != 2 or eeg.shape[1] < n_win:
        return np.empty(0), np.empty((0, eeg.shape[0] if eeg.ndim == 2 else 0, 3))
    x = preprocess(eeg, srate, mains)
    starts = np.arange(0, x.shape[1] - n_win + 1, n_step)
    epochs = np.stack([x[:, s:s + n_win] for s in starts])               # epochs × channels × samples
    spectrum = np.abs(np.fft.rfft(epochs * np.hanning(n_win), axis=2)) ** 2
    freqs = np.fft.rfftfreq(n_win, 1 / srate)
    powers = np.stack([spectrum[:, :, (freqs >= lo) & (freqs < hi)].sum(axis=2) for lo, hi in (THETA, ALPHA, BETA)], axis=2)
    ptp = np.ptp(epochs, axis=2)
    bad = (ptp > ARTIFACT_UV) | (epochs.std(axis=2) < FLAT_UV)
    powers[bad] = np.nan
    return (starts + n_win) / srate, powers


def _index(powers: np.ndarray) -> float | None:
    """β / (α + θ) from band powers averaged over every clean epoch and channel given."""
    if powers.size == 0 or np.isnan(powers).all():
        return None
    with np.errstate(all="ignore"):
        theta, alpha, beta = np.nanmean(powers.reshape(-1, 3), axis=0)
    if not np.isfinite(theta + alpha + beta) or theta + alpha <= 0:
        return None
    return float(beta / (alpha + theta))


def engagement_index(eeg: np.ndarray, srate: float, mains: float = MAINS_HZ) -> float | None:
    """The raw engagement index over a whole stretch of EEG (a paragraph visit, say).
    None when there's less than one clean second of it."""
    return _index(epoch_band_powers(eeg, srate, mains)[1])


def engagement_series(eeg: np.ndarray, srate: float, window: float = WINDOW_SECONDS,
                      step: float = SCORE_STEP_SECONDS, mains: float = MAINS_HZ) -> tuple[np.ndarray, np.ndarray]:
    """The raw index the way the paper's live system computes it: every `step` seconds, over the
    last `window` seconds. Returns (times in seconds from the start, values; NaN where all artifact)."""
    ends, powers = epoch_band_powers(eeg, srate, mains)
    duration = eeg.shape[1] / srate if eeg.ndim == 2 else 0.0
    times = np.arange(window, duration + 1e-9, step)
    values = np.array([np.nan if (v := _index(powers[(ends > t - window) & (ends <= t)])) is None else v
                       for t in times])
    return times, values


# ---- calibration and normalization ------------------------------------------------------------

class CalibrationError(ValueError):
    """The calibration recordings can't give a usable range; the message is shown to the user."""


@dataclass(frozen=True)
class Calibration:
    e_min: float
    e_max: float
    source: str = "calibration"   # or "session": judged against this reading only, no calibration done

    def __post_init__(self):
        if not (np.isfinite(self.e_min) and np.isfinite(self.e_max)) or self.e_max <= self.e_min:
            raise CalibrationError("The focus task didn't read as more engaged than relaxing. "
                                   "Check the headset fit and run the calibration again.")

    def normalize(self, e: float) -> float:
        return float(np.clip((e - self.e_min) / (self.e_max - self.e_min), 0.0, 1.0))

    @classmethod
    def from_recordings(cls, relax: np.ndarray, task: np.ndarray, srate: float, mains: float = MAINS_HZ) -> "Calibration":
        """E_min: the lowest 10 s score while relaxing. E_max: the highest while doing the word chain."""
        return cls(calibration_bound(relax, srate, "relax", mains), calibration_bound(task, srate, "task", mains))

    @classmethod
    def from_session(cls, eeg: np.ndarray, srate: float, mains: float = MAINS_HZ) -> "Calibration | None":
        """Without a calibration: this reading's own range (5th–95th percentile of its 15 s scores),
        so a score says how engaged they are compared with the rest of the reading. None if too short."""
        if eeg.ndim != 2 or eeg.shape[1] < MIN_SESSION_SECONDS * srate:
            return None
        values = engagement_series(eeg, srate, mains=mains)[1]
        values = values[np.isfinite(values)]
        if len(values) < 5:
            return None
        lo, hi = np.percentile(values, [5, 95])
        try:
            return cls(float(lo), float(hi), source="session")
        except CalibrationError:
            return None


def calibration_bound(eeg: np.ndarray, srate: float, phase: str, mains: float = MAINS_HZ) -> float:
    """One half of a calibration: the minimum over the relax recording or the maximum over the task."""
    if eeg.ndim != 2 or eeg.shape[1] < CALIBRATION_WINDOW_SECONDS * srate:
        raise CalibrationError(f"The {phase} recording is shorter than {CALIBRATION_WINDOW_SECONDS:.0f} seconds.")
    values = engagement_series(eeg, srate, window=CALIBRATION_WINDOW_SECONDS, mains=mains)[1]
    values = values[np.isfinite(values)]
    if not len(values):
        raise CalibrationError(f"The {phase} recording was all movement or bad contact. Sit still and try again.")
    return float(values.min() if phase == "relax" else values.max())


# ---- buckets and the prompt -----------------------------------------------------------------

@dataclass(frozen=True)
class Bucket:
    name: str
    lower: float          # inclusive lower edge of the normalized score
    summary: str          # what the score suggests about the reader
    guidance: tuple[str, ...]


# Three bands of the 0–1 score. The edges sit a little below thirds because E_max is the single
# highest 10 s window of an effortful task: sustained reading as engaged as that task lands around
# 0.6–0.8, not near 1. The instructions follow the paper's system prompt (Appendix A.1):
# lower engagement → shorter, story-like, easier text that helps them find a question they're
# curious about; higher → more complex, scientific, in-depth.
BUCKETS = (
    Bucket("low", 0.0, "Their engagement is low: they have likely drifted off or feel overloaded.", (
        "Keep it under 80 words, in short sentences and everyday words.",
        "Tell it as a small story or one concrete, familiar example instead of a list of facts.",
        "Skip side details and caveats; one idea only.",
        "End with one inviting question that makes them curious about the idea, not a quiz.",
    )),
    Bucket("moderate", 0.3, "Their engagement is steady.", (
        "Explain at a normal depth, up to 120 words: the main idea first, then the key detail.",
        "Define any jargon you keep and use one analogy if it helps.",
        "End by checking which part is still unclear.",
    )),
    Bucket("high", 0.6, "They are highly engaged and have room to go deeper.", (
        "Be precise and more technical: explain the mechanism, why it works, not just what happens.",
        "Use the correct terms (define each once) and you may go up to 180 words.",
        "Add one connection to a related idea or a consequence worth knowing.",
        "End with a question that pushes their thinking one step further.",
    )),
)


def bucket_for(score: float) -> Bucket:
    return next(b for b in reversed(BUCKETS) if score >= b.lower)


@dataclass(frozen=True)
class Reading:
    """One engagement reading for the prompt: raw index, normalized score and its bucket."""
    raw: float
    score: float
    bucket: Bucket
    source: str           # "calibration" or "session"
    where: str            # "on this paragraph" or "right now"

    def as_dict(self) -> dict:
        return {"raw": round(self.raw, 4), "score": round(self.score, 3), "bucket": self.bucket.name,
                "source": self.source, "where": self.where}


def reading(raw: float | None, calibration: Calibration | None, where: str) -> Reading | None:
    if raw is None or calibration is None:
        return None
    score = calibration.normalize(raw)
    return Reading(raw, score, bucket_for(score), calibration.source, where)


def engagement_notes(r: Reading) -> tuple[str, list[str]]:
    """For the tutor's system prompt: what was measured (one line) and the bucket's instructions."""
    against = ("normalized 0–1 against their own relaxed and focused calibration" if r.source == "calibration"
               else "0–1 relative to the rest of this reading; no calibration was done")
    seen = (f"- EEG engagement {r.where}: {r.score:.2f} on a 0–1 scale ({against}), "
            f"which puts them in the {r.bucket.name.upper()} band. {r.bucket.summary}")
    return seen, [*r.bucket.guidance, "These instructions override the length and depth given above."]


# ---- live use in the companion ----------------------------------------------------------------

class LiveEngagement:
    """Engagement for the companion app, from the headset buffer.

    eeg_between(t0, t1) and window(seconds) read the device buffer, srate() its sample rate.
    Calibration runs as two timed recordings marked with start(phase) and finish(phase)."""

    def __init__(self, eeg_between: Callable[[float, float], np.ndarray], window: Callable[[float], np.ndarray],
                 srate: Callable[[], float], clock: Callable[[], float]):
        self._eeg_between, self._window, self._srate, self._clock = eeg_between, window, srate, clock
        self.calibration: Calibration | None = None
        self.bounds: dict[str, float] = {}
        self._recording: dict[str, float] = {}

    def start(self, phase: str) -> None:
        self._recording[phase] = self._clock()

    def finish(self, phase: str) -> float:
        """Ends a calibration recording; once both are in, the calibration takes effect."""
        if phase not in self._recording:
            raise CalibrationError(f"The {phase} recording wasn't started.")
        t0 = self._recording.pop(phase)
        self.bounds[phase] = calibration_bound(self._eeg_between(t0, self._clock()), self._srate(), phase)
        if {"relax", "task"} <= self.bounds.keys():
            self.calibration = Calibration(self.bounds["relax"], self.bounds["task"])
        return self.bounds[phase]

    def set(self, e_min: float, e_max: float) -> None:
        self.calibration = Calibration(e_min, e_max)
        self.bounds = {"relax": e_min, "task": e_max}

    def clear(self) -> None:
        self.calibration, self.bounds, self._recording = None, {}, {}

    def _reference(self) -> Calibration | None:
        return self.calibration or Calibration.from_session(self._window(SESSION_SECONDS), self._srate())

    def raw_now(self) -> float | None:
        """The paper's live index: the last 15 seconds."""
        eeg = self._window(WINDOW_SECONDS)
        if eeg.shape[1] < WINDOW_SECONDS * self._srate() * 0.9:
            return None
        return engagement_index(eeg, self._srate())

    def now(self) -> Reading | None:
        """The live index, normalized and bucketed (None until there's something to judge it against)."""
        return reading(self.raw_now(), self._reference(), "over the last 15 seconds")

    def of(self, raw: float | None, where: str) -> Reading | None:
        """A raw index measured elsewhere (a paragraph's visits) on the same scale."""
        return reading(raw, self._reference(), where)

    def status(self) -> dict:
        raw = self.raw_now()
        now = reading(raw, self._reference(), "over the last 15 seconds")
        return {"calibrated": self.calibration is not None, "bounds": self.bounds,
                "recording": sorted(self._recording),
                "now": now.as_dict() if now else None if raw is None else {"raw": round(raw, 4), "score": None, "bucket": None},
                "buckets": [{"name": b.name, "from": round(b.lower, 3)} for b in BUCKETS]}


# ---- command line: synthetic data and offline scoring ---------------------------------------------

def score_recording(eeg: np.ndarray, srate: float, calibration: Calibration | None, mains: float = MAINS_HZ) -> dict:
    """Per-second normalized score and bucket over a recording, as the live system would see it."""
    calibration = calibration or Calibration.from_session(eeg, srate, mains)
    times, raw = engagement_series(eeg, srate, mains=mains)
    rows = []
    for t, e in zip(times, raw):
        r = reading(None if np.isnan(e) else float(e), calibration, "")
        rows.append({"t": float(t), "raw": None if r is None else round(r.raw, 4),
                     "score": None if r is None else round(r.score, 3), "bucket": None if r is None else r.bucket.name})
    counts = {b.name: sum(1 for r in rows if r["bucket"] == b.name) for b in BUCKETS}
    return {"calibration": None if calibration is None else
            {"e_min": calibration.e_min, "e_max": calibration.e_max, "source": calibration.source},
            "seconds": rows, "buckets": counts}


def _cmd_synth(args) -> None:
    from .recording import save_csv
    from .synthetic import synthetic_session
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    session = synthetic_session(seed=args.seed)
    for name, eeg in session.recordings.items():
        save_csv(out / f"{name}.csv", eeg, session.srate)
    (out / "labels.json").write_text(json.dumps(session.labels, indent=2))
    print(f"Wrote {', '.join(f'{n}.csv' for n in session.recordings)} and labels.json to {out}")


def _cmd_score(args) -> None:
    from .recording import load_recording
    rec = load_recording(args.reading, srate=args.srate)
    calibration = None
    if args.relax and args.task:
        relax, task = load_recording(args.relax, srate=args.srate), load_recording(args.task, srate=args.srate)
        calibration = Calibration(calibration_bound(relax.eeg, relax.srate, "relax", args.mains),
                                  calibration_bound(task.eeg, task.srate, "task", args.mains))
    result = score_recording(rec.eeg, rec.srate, calibration, args.mains)
    if args.json:
        json.dump(result, sys.stdout, indent=1)
        print()
        return
    c = result["calibration"]
    print(f"{rec.eeg.shape[1] / rec.srate:.0f} s of EEG at {rec.srate:.0f} Hz, channels {', '.join(rec.channels)}")
    print("Calibration: " + ("none (too short to judge)" if c is None else
                             f"E_min {c['e_min']:.3f}, E_max {c['e_max']:.3f} ({c['source']})"))
    for row in result["seconds"][::args.every]:
        bar = "" if row["score"] is None else "█" * int(round(row["score"] * 30))
        print(f"{row['t']:6.0f}s  raw {row['raw'] if row['raw'] is not None else '  -  ':>6}  "
              f"score {row['score'] if row['score'] is not None else '  -  ':>5}  {row['bucket'] or '-':8} {bar}")
    print("Seconds per bucket:", ", ".join(f"{k} {v}" for k, v in result["buckets"].items()))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="python -m companion.engagement", description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("synth", help="write a synthetic calibration + reading session as Muse-style CSVs")
    s.add_argument("--out", default="synthetic-eeg")
    s.add_argument("--seed", type=int, default=1)
    s.set_defaults(func=_cmd_synth)
    c = sub.add_parser("score", help="score a recording (CSV, NPZ or XDF) per second and bucket it")
    c.add_argument("reading")
    c.add_argument("--relax", help="relaxed calibration recording")
    c.add_argument("--task", help="word-chain (focused) calibration recording")
    c.add_argument("--srate", type=float, help="sample rate, if the file has no timestamps (default 256)")
    c.add_argument("--mains", type=float, default=MAINS_HZ)
    c.add_argument("--every", type=int, default=5, help="print every Nth second")
    c.add_argument("--json", action="store_true")
    c.set_defaults(func=_cmd_score)
    args = p.parse_args(argv)
    try:
        args.func(args)
    except (CalibrationError, ValueError, OSError) as e:
        p.exit(1, f"error: {e}\n")


if __name__ == "__main__":
    main()
