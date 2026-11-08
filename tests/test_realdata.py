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
