import json

import numpy as np
import pytest

from companion.engagement import (BUCKETS, Calibration, CalibrationError, bucket_for, engagement_index,
                                  engagement_notes, engagement_series, epoch_band_powers, main, reading,
                                  score_recording)
from companion.recording import load_recording, save_csv
from companion.synthetic import READING_SCRIPT, synthetic_eeg, synthetic_session

SRATE = 256.0


def sine(freq, seconds=4.0, amp=10.0, offset=800.0):
    t = np.arange(int(seconds * SRATE)) / SRATE
    return np.tile(offset + amp * np.sin(2 * np.pi * freq * t), (4, 1))


def test_index_uses_the_papers_bands():
    # θ 4–7, α 7–11, β 11–20 Hz (§3.2.3): 15 Hz is β, 9 Hz is α, 25 Hz is outside every band.
    assert engagement_index(sine(15), SRATE) > 10
    assert engagement_index(sine(9), SRATE) < 0.1 and engagement_index(sine(5), SRATE) < 0.1
    mixed = sine(15) + sine(9, offset=0) + sine(25, amp=40, offset=0)
    assert 0.5 < engagement_index(mixed, SRATE) < 2   # β ≈ α; the 25 Hz tone doesn't count
    assert engagement_index(sine(15, seconds=0.5), SRATE) is None


def test_mains_hum_and_dc_offset_dont_change_the_index():
    eeg = synthetic_eeg(0.5, 20, seed=2, blinks_per_minute=0)
    hum = sine(60, seconds=20, amp=30, offset=-400)
    assert engagement_index(eeg + hum, SRATE) == pytest.approx(engagement_index(eeg, SRATE), rel=0.03)


def test_epochs_are_1s_every_250ms_and_artifacts_are_dropped():
    eeg = synthetic_eeg(0.5, 10, seed=3, blinks_per_minute=0)
    ends, powers = epoch_band_powers(eeg, SRATE)
    assert len(ends) == 37 and ends[0] == 1.0 and np.allclose(np.diff(ends), 0.25)
    assert powers.shape == (37, 4, 3) and not np.isnan(powers).any()
    eeg[1:3, 5 * 256:5 * 256 + 77] += 350 * np.hanning(77)      # a blink on AF7/AF8 at 5 s
    _, powers = epoch_band_powers(eeg, SRATE)
    dropped = np.isnan(powers[:, :, 0])
    assert dropped[:, 1:3].any() and not dropped[:, [0, 3]].any()
    clean = engagement_index(synthetic_eeg(0.5, 10, seed=3, blinks_per_minute=0), SRATE)
    assert engagement_index(eeg, SRATE) == pytest.approx(clean, rel=0.1)
    eeg[0] = 800.0                                              # a sensor off the skin is ignored too
    assert np.isnan(epoch_band_powers(eeg, SRATE)[1][:, 0]).all()


def test_index_rises_with_synthetic_engagement():
    values = [engagement_index(synthetic_eeg(level, 30, seed=5), SRATE) for level in (0, 0.25, 0.5, 0.75, 1)]
    assert values == sorted(values) and values[-1] > 2.5 * values[0]


def test_live_series_updates_every_second_over_15_seconds():
    eeg = synthetic_eeg([0.1] * 30 + [0.9] * 30, 60, seed=6)
    times, values = engagement_series(eeg, SRATE)
    assert times[0] == 15 and np.allclose(np.diff(times), 1) and times[-1] == 60
    assert values[times == 30][0] < values[times == 60][0]
    assert len(engagement_series(eeg[:, :10 * 256], SRATE)[0]) == 0   # shorter than one window


def test_calibration_normalizes_the_synthetic_reading_into_the_right_buckets():
    s = synthetic_session(seed=1)
    cal = Calibration.from_recordings(s.recordings["relax"], s.recordings["task"], SRATE)
    assert cal.e_min < cal.e_max and cal.source == "calibration"
    got = {}
    for p in s.labels["reading"]:
        raw = engagement_index(s.recordings["reading"][:, int(p["start"] * SRATE):int(p["end"] * SRATE)], SRATE)
        got[p["level"]] = reading(raw, cal, "here")
    assert got[0.1].bucket.name == "low" and got[1.0].bucket.name == "high"
    assert got[0.5].bucket.name == got[0.55].bucket.name == "moderate"
    assert got[0.1].score < got[0.45].score < got[0.55].score < got[1.0].score
    assert [p["level"] for p in s.labels["reading"]] == [lv for _, _, lv in READING_SCRIPT]


def test_calibration_rejects_unusable_recordings():
    relax, task = synthetic_eeg(0.05, 20, seed=1), synthetic_eeg(0.95, 20, seed=2)
    with pytest.raises(CalibrationError, match="didn't read as more engaged"):
        Calibration.from_recordings(task, relax, SRATE)
    with pytest.raises(CalibrationError, match="shorter than 10 seconds"):
        Calibration.from_recordings(relax[:, :5 * 256], task, SRATE)
    with pytest.raises(CalibrationError, match="all movement"):
        Calibration.from_recordings(relax * 0 + 800, task, SRATE)
    assert Calibration(0.2, 1.0).normalize(5) == 1 and Calibration(0.2, 1.0).normalize(0) == 0


def test_session_reference_when_uncalibrated():
    assert Calibration.from_session(synthetic_eeg(0.5, 20, seed=1), SRATE) is None   # too little to judge
    ref = Calibration.from_session(synthetic_eeg([0.1] * 40 + [0.9] * 40, 80, seed=1), SRATE)
    assert ref.source == "session" and ref.e_min < ref.e_max


def test_at_least_three_buckets_cover_zero_to_one():
    assert len(BUCKETS) >= 3 and BUCKETS[0].lower == 0
    assert [bucket_for(x).name for x in (0, 0.29, 0.3, 0.5, 0.59, 0.6, 1)] == \
        ["low", "low", "moderate", "moderate", "moderate", "high", "high"]


def test_each_bucket_changes_what_the_tutor_is_told():
    cal = Calibration(0.0, 1.0)
    notes = {b: engagement_notes(reading(x, cal, "right now")) for b, x in (("low", 0.1), ("moderate", 0.5), ("high", 0.9))}
    assert "LOW band" in notes["low"][0] and any("under 80 words" in g for g in notes["low"][1])
    assert any("curious" in g for g in notes["low"][1])
    assert "MODERATE band" in notes["moderate"][0] and any("120 words" in g for g in notes["moderate"][1])
    assert "HIGH band" in notes["high"][0] and any("mechanism" in g for g in notes["high"][1])
    assert len({tuple(g) for _, g in notes.values()}) == 3
    uncal = engagement_notes(reading(0.5, Calibration(0, 1, source="session"), "right now"))[0]
    assert "no calibration was done" in uncal


def test_csv_round_trip_and_mind_monitor_files(tmp_path):
    eeg = synthetic_eeg(0.5, 12, seed=1)
    save_csv(tmp_path / "r.csv", eeg, SRATE)
    rec = load_recording(tmp_path / "r.csv")
    assert rec.srate == pytest.approx(SRATE) and rec.channels == ["TP9", "AF7", "AF8", "TP10"]
    assert np.allclose(rec.eeg, eeg, atol=1e-3)
    # Mind Monitor: datetime stamps, RAW_ columns, extra columns, and blank "Elements" rows in between.
    lines = ["TimeStamp,Delta_TP9,RAW_TP9,RAW_AF7,RAW_AF8,RAW_TP10,Elements"]
    for i in range(512):
        lines.append(f"2026-10-27 10:00:{i / 256:09.6f},0.1,{eeg[0, i]},{eeg[1, i]},{eeg[2, i]},{eeg[3, i]},")
        if i % 100 == 0:
            lines.append("2026-10-27 10:00:00.000,,,,,,/muse/elements/blink")
    (tmp_path / "mm.csv").write_text("\n".join(lines))
    mm = load_recording(tmp_path / "mm.csv")
    assert mm.eeg.shape == (4, 512) and mm.srate == pytest.approx(SRATE, rel=0.01)
    np.savez(tmp_path / "r.npz", eeg=eeg, srate=SRATE)
    assert load_recording(tmp_path / "r.npz").eeg.shape == eeg.shape
    (tmp_path / "bad.csv").write_text("time,Fz,Cz\n0,1,2\n")
    with pytest.raises(ValueError, match="no column for TP9"):
        load_recording(tmp_path / "bad.csv")


def test_command_line_synth_then_score(tmp_path, capsys):
    main(["synth", "--out", str(tmp_path)])
    labels = json.loads((tmp_path / "labels.json").read_text())
    assert {p.name for p in tmp_path.iterdir()} == {"relax.csv", "task.csv", "reading.csv", "labels.json"}
    capsys.readouterr()
    main(["score", str(tmp_path / "reading.csv"), "--relax", str(tmp_path / "relax.csv"),
          "--task", str(tmp_path / "task.csv"), "--json"])
    result = json.loads(capsys.readouterr().out)
    assert result["calibration"]["source"] == "calibration"
    assert all(result["buckets"][b] > 0 for b in ("low", "moderate", "high"))
    # The score follows the script: the drifting paragraph reads lower than the gripping one.
    by_t = {row["t"]: row["score"] for row in result["seconds"]}
    gripping, drifting = (p for p in labels["reading"] if p["level"] in (1.0, 0.1))
    assert by_t[gripping["end"]] > by_t[drifting["end"]]
    main(["score", str(tmp_path / "reading.csv")])
    assert "(session)" in capsys.readouterr().out


def test_score_recording_without_enough_data():
    result = score_recording(synthetic_eeg(0.5, 12, seed=1), SRATE, None)
    assert result["calibration"] is None and result["seconds"] == []
