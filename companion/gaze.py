"""Which paragraph the reader's eyes are on, lined up with the EEG recorded at the time.

The reading page sends an event each time the gaze settles on a paragraph or leaves the text.
Each event is stamped with time.monotonic() when it arrives, the clock the EEG buffer uses, so
every paragraph visit maps onto the EEG recorded during it: gaze says where, EEG says whether
the reader was engaged there.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import numpy as np
from scipy.signal import welch

MIN_VISIT_SECONDS = 0.3     # shorter visits are passing glances, not reading
MIN_EEG_SECONDS = 1.0       # too little EEG for a band-power estimate
THETA, ALPHA, BETA = (4, 8), (8, 13), (13, 30)


def engagement_index(eeg: np.ndarray, srate: float) -> float | None:
    """Pope et al.'s engagement index, beta / (alpha + theta), averaged over channels.
    eeg is channels × samples in µV; None when there isn't enough of it."""
    if eeg.ndim != 2 or eeg.shape[1] < MIN_EEG_SECONDS * srate:
        return None
    freqs, psd = welch(eeg - eeg.mean(axis=1, keepdims=True), fs=srate, nperseg=min(eeg.shape[1], int(2 * srate)))

    def band(lo_hi):
        lo, hi = lo_hi
        return psd[:, (freqs >= lo) & (freqs < hi)].sum(axis=1)

    denom = band(ALPHA) + band(THETA)
    ok = denom > 0
    if not ok.any():
        return None
    return float(np.mean(band(BETA)[ok] / denom[ok]))


@dataclass
class Visit:
    paragraph: int
    start: float
    end: float
    engagement: float | None

    @property
    def seconds(self) -> float:
        return self.end - self.start


class GazeSession:
    """Paragraph visits for one reading. eeg_between(t0, t1) returns channels × samples (empty
    without a headset) and srate() the EEG sample rate."""

    def __init__(self, eeg_between: Callable[[float, float], np.ndarray], srate: Callable[[], float],
                 clock: Callable[[], float] = time.monotonic):
        self._eeg_between = eeg_between
        self._srate = srate
        self._clock = clock
        self.visits: list[Visit] = []
        self._open: tuple[int, float] | None = None   # (paragraph, since)

    def reset(self) -> None:
        self.visits = []
        self._open = None

    def enter(self, paragraph: int) -> Visit | None:
        """The eyes settled on a paragraph. Closes the previous visit, if any, and returns it."""
        closed = self.leave()
        self._open = (paragraph, self._clock())
        return closed

    def leave(self) -> Visit | None:
        """The eyes left the text (or the face was lost). Returns the visit this closes, if it counts."""
        if self._open is None:
            return None
        (paragraph, start), end = self._open, self._clock()
        self._open = None
        if end - start < MIN_VISIT_SECONDS:
            return None
        visit = Visit(paragraph, start, end, engagement_index(self._eeg_between(start, end), self._srate()))
        self.visits.append(visit)
        return visit

    def summary(self) -> dict:
        """Per paragraph: seconds read, visits, and EEG engagement (time-weighted over visits that
        had EEG), plus the reading's median engagement to compare against."""
        rows: dict[int, dict] = {}
        for v in self.visits:
            r = rows.setdefault(v.paragraph, {"paragraph": v.paragraph, "seconds": 0.0, "visits": 0, "_e": 0.0, "_es": 0.0})
            r["seconds"] += v.seconds
            r["visits"] += 1
            if v.engagement is not None:
                r["_e"] += v.engagement * v.seconds
                r["_es"] += v.seconds
        paragraphs = []
        for r in sorted(rows.values(), key=lambda r: r["paragraph"]):
            e, es = r.pop("_e"), r.pop("_es")
            r["engagement"] = e / es if es else None
            r["seconds"] = round(r["seconds"], 2)
            paragraphs.append(r)
        known = [r["engagement"] for r in paragraphs if r["engagement"] is not None]
        return {"paragraphs": paragraphs, "median_engagement": float(np.median(known)) if known else None}


def visit_json(v: Visit) -> dict:
    return {"type": "visit", "paragraph": v.paragraph, "seconds": round(v.seconds, 2), "engagement": v.engagement}
