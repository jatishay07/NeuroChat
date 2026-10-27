"""Eye-movement detectors (P1): blinks, horizontal saccades with size, jaw clenches; dataset loader and scoring."""
import csv
import json

import numpy as np
import pytest

from companion import eyemove
from companion.eyedata import (Saccade, find_tracking_files, load_tracking_csv, mm_to_deg, score_saccades,
                               stimulus_jumps, synthetic_eyes)
from companion.eyemove import AF7, AF8, detect, detect_saccades, fit_gain
from companion.recording import save_csv

BLINKS = [10.3, 33.1, 57.7, 80.2]
CLENCHES = [(20.0, 21.0), (70.0, 70.6)]
NO_LAG = (-0.1, 0.3)   # synthetic eyes move exactly at the jump; people lag ~200 ms


@pytest.fixture(scope="module")
def session():
    s = synthetic_eyes(120, seed=1, blinks=BLINKS, clenches=CLENCHES, gain_uv_per_deg=4.0)
    return s, detect(s.eeg, s.srate)


def test_finds_every_blink_and_nothing_else(session):
    _, ev = session
    assert len(ev.blinks) == len(BLINKS)
    for b, t in zip(ev.blinks, BLINKS):
        assert abs(b.t - t) < 0.1


def test_finds_each_jaw_clench(session):
    _, ev = session
    assert len(ev.clenches) == len(CLENCHES)
    for c, (t0, t1) in zip(ev.clenches, CLENCHES):
        assert abs(c.start - t0) < 0.2 and abs(c.end - t1) < 0.2


def test_large_saccades_found_with_their_direction(session):
    s, ev = session
    score = score_saccades(ev.saccades, s.jumps, 120, window=NO_LAG)
    big = next(r for r in score.by_size() if r["size_deg"] == "10-20")
    assert big["hit_rate"] >= 0.9
    assert big["right_direction"] == 1.0
    assert score.false_alarms_per_minute < 1.0


def test_saccade_size_tracks_jump_size(session):
    s, ev = session
    score = score_saccades(ev.saccades, s.jumps, 120, window=NO_LAG)
    hits = [m for m in score.matches if m.saccade]
    gain = fit_gain([m.saccade.step_uv for m in hits], [m.jump_deg for m in hits])
    # The step filter's ramp gap shaves a little off; within 25% of the true 4 µV/degree.
    assert 3.0 <= gain <= 5.0
    sized = detect_saccades(s.eeg, s.srate, ev.blinks, gain_uv_per_deg=gain)
    errors = [abs(m.saccade.step_uv / gain - m.jump_deg) for m in hits]
    assert np.median(errors) < 2.0
    assert all(x.degrees is not None for x in sized)


def test_blinks_are_not_saccades():
    s = synthetic_eyes(60, seed=3, jumps=[], blinks=[5.0, 15.0, 25.0, 35.0, 45.0])
    ev = detect(s.eeg, s.srate)
    assert len(ev.blinks) == 5
    assert ev.saccades == []


def test_quiet_eyes_give_no_events():
    s = synthetic_eyes(60, seed=4, jumps=[])
    ev = detect(s.eeg, s.srate)
    assert ev.saccades == [] and ev.blinks == [] and ev.clenches == []


def test_dropped_samples_are_tolerated():
    s = synthetic_eyes(60, seed=5, blinks=[30.0])
    eeg = s.eeg.copy()
    eeg[:, 1000:1040] = np.nan
    ev = detect(eeg, s.srate)
    assert len(ev.blinks) == 1 and len(ev.saccades) > 10


def test_fit_gain_needs_known_sizes():
    assert fit_gain([8, -16, 40], [2, -4, 10]) == pytest.approx(4.0)
    with pytest.raises(ValueError):
        fit_gain([8], [2])


def test_scoring_counts_hits_misses_and_false_alarms():
    sac = [Saccade(onset=1.25, offset=1.3, step_uv=20), Saccade(onset=5.0, offset=5.1, step_uv=-5),
           Saccade(onset=9.3, offset=9.4, step_uv=-30)]
    jumps = [(1.0, 5.0), (3.0, -8.0), (9.0, -12.0), (9.0, 0.2)]
    score = score_saccades(sac, jumps, 60)
    assert [m.saccade is not None for m in score.matches] == [True, False, True]
    assert score.false_alarms == 1
    rows = {r["size_deg"]: r for r in score.by_size()}
    assert rows["5-10"]["hits"] == 1 and rows["5-10"]["jumps"] == 2
    assert rows["10-20"]["right_direction"] == 1.0


def _write_tracking_csv(path, seconds=20.0):
    """A file shaped like the Afonso & Heinrichs csv_raw export, with known dot jumps."""
    s = synthetic_eyes(seconds, seed=7, jumps=[(4.0, 10.0), (9.0, -10.0), (14.0, 5.0)])
    n = s.eeg.shape[1]
    t = 1000.0 + np.arange(n) / s.srate
    stim_x = np.zeros(n)
    stim_x[int(4.0 * s.srate):] += np.tan(np.radians(10.0)) * 600
    stim_x[int(9.0 * s.srate):] = 0.0
    stim_x[int(14.0 * s.srate):] = np.tan(np.radians(5.0)) * 600
    eeg = s.eeg.copy()
    eeg[:, 100:110] = 0.0   # the export writes missing samples as 0
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Timestamp", "EEG_TP9", "EEG_AF7", "EEG_AF8", "EEG_TP10", "Gaze_x", "Gaze_y",
                    "Stimulus_x", "Stimulus_y"])
        for i in range(n):
            w.writerow([f"{t[i]:.6f}", *(f"{v:.3f}" for v in eeg[:, i]), f"{stim_x[i]:.2f}", "0",
                        f"{stim_x[i]:.2f}", "0"])
    return s


def test_loads_the_tracking_dataset_format(tmp_path):
    path = tmp_path / "P001_01_level-1-saccades_train.csv"
    _write_tracking_csv(path)
    rec = load_tracking_csv(path)
    assert rec.task == "level-1-saccades"
    assert rec.eeg.shape[0] == 4 and abs(rec.srate - 256) < 1
    assert np.isnan(rec.eeg[:, 100:110]).all()
    jumps = stimulus_jumps(rec)
    assert [round(t) for t, _, _ in jumps] == [4, 9, 14]
    assert [round(dx) for _, dx, _ in jumps] == [10, -10, 5]
    ev = detect(rec.eeg, rec.srate)
    score = score_saccades(ev.saccades, [(t, dx) for t, dx, _ in jumps], 20, window=NO_LAG)
    assert sum(m.saccade is not None for m in score.matches) >= 2
    assert find_tracking_files(tmp_path) == [path]
    assert find_tracking_files(tmp_path, "smooth") == []


def test_mm_to_degrees():
    assert mm_to_deg(0) == 0
    assert mm_to_deg(np.tan(np.radians(10)) * 600) == pytest.approx(10.0)


def test_channel_order_matches_the_headset():
    assert (AF7, AF8) == (1, 2)


def test_command_line_summary(tmp_path, capsys):
    s = synthetic_eyes(30, seed=2, blinks=[10.0])
    path = tmp_path / "rec.csv"
    save_csv(path, s.eeg, s.srate)
    eyemove.main([str(path), "--events"])
    out = json.loads(capsys.readouterr().out)
    assert out["blinks"] == 1 and out["saccades"] > 5
    assert len(out["events"]["saccades"]) == out["saccades"]


def test_phase1_report_over_a_folder(tmp_path, capsys):
    from companion import eyedata
    for i in range(2):
        _write_tracking_csv(tmp_path / f"P00{i}_01_level-1-saccades_train.csv", seconds=25.0)
    (tmp_path / "P009_01_level-1-smooth_train.csv").write_text("Timestamp\n")   # filtered out by task
    (tmp_path / "P008_01_level-1-saccades_test.csv").write_text("Timestamp,EEG_TP9\n1,2\n")  # unreadable
    eyedata.main([str(tmp_path), "--out", str(tmp_path / "report.json")])
    report = json.loads((tmp_path / "report.json").read_text())
    assert report == json.loads(capsys.readouterr().out)
    assert report["recordings"] == 2 and len(report["skipped"]) == 1
    assert [r["k"] for r in report["thresholds"]] == list(eyedata.THRESHOLDS)
    assert report["p3"]["k"] is not None
    with pytest.raises(SystemExit):
        eyedata.main([str(tmp_path / "nothing-here")])
