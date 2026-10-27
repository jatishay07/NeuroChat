"""Which paragraph the reader's eyes are on, lined up with the EEG recorded at the time.

The reading page sends an event each time the gaze settles on a paragraph or leaves the text.
Each event is stamped with time.monotonic() when it arrives, the clock the EEG buffer uses, so
every paragraph visit maps onto the EEG recorded during it: gaze says where, EEG says whether
the reader was engaged there. The engagement index itself is the NeuroChat kernel in engagement.py.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable

import numpy as np

from .engagement import engagement_index

MIN_VISIT_SECONDS = 0.3     # shorter visits are passing glances, not reading


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
