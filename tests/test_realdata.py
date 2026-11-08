"""The kernel on real Muse recordings (companion/realdata.py).

Needs the files, so it runs only when NEUROCHAT_BIRD_DATA points at a folder
made by `python -m companion.realdata --out <folder>`.
"""

import os
from pathlib import Path

import numpy as np
import pytest

from companion.realdata import report
from companion.realdata import SUBJECTS

FOLDER = os.environ.get("NEUROCHAT_BIRD_DATA")
pytestmark = pytest.mark.skipif(
    not FOLDER, reason="set NEUROCHAT_BIRD_DATA to run on the real recordings"
)


def test_concentrating_reads_more_engaged_than_neutral_on_real_eeg():
    rows = report(Path(FOLDER))
    higher = []
    for s in SUBJECTS:
        raw = rows[s]["raw"]
        concentrating = np.mean(
            [raw["concentrating-1"], raw["concentrating-2"]]
        )
        neutral = np.mean([raw["neutral-1"], raw["neutral-2"]])
        higher.append(concentrating > neutral)
    assert sum(higher) >= 3, (
        rows
    )  # a, b and d clearly; c is a tie (0.257 against 0.260)
    # Held out: calibrated on session 1, scored on session 2 (subjects with both
    # recordings long enough).
    for s in "ab":
        held = rows[s]["held_out"]
        assert held["concentrating"]["mean"] > held["neutral"]["mean"], (
            s,
            held,
        )


def test_replay_bird_plays_a_low_a_moderate_and_a_high_minute():
    """--replay bird: scored with its own calibration, the three minutes read
    mostly low, then mostly moderate, then high, in that order, and bird:BAND
    picks one of them.
    """
    from collections import Counter

    from companion.engagement import bucket_for
    from companion.engagement import Calibration
    from companion.engagement import engagement_series
    from companion.recording import BIRD_PARTS
    from companion.recording import replay_backend

    backend = replay_backend("bird")
    cal = Calibration(*backend.calibration)
    assert [
        label.split("(reads ")[1][:-1] for _, _, label in backend.parts
    ] == [
        "low",
        "moderate",
        "high",
    ]
    for (start, end, label), band in zip(
        backend.parts, BIRD_PARTS, strict=True
    ):
        values = engagement_series(backend.data[:, start:end], backend.srate)[1]
        values = values[np.isfinite(values)]
        buckets = Counter(bucket_for(cal.normalize(v)).name for v in values)
        assert buckets.most_common(1)[0][0] == band, (label, buckets)
    one = replay_backend("bird:moderate")
    assert (
        len(one.parts) == 1
        and "concentrating (reads moderate)" in one.parts[0][2]
    )
    with pytest.raises(ValueError, match="choose from"):
        replay_backend("bird:medium")
