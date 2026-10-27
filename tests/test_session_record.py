"""Recording mode (T7): samples_between, the session recorder, its summary, and the /api/record + /ws/record routes."""
import json
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from companion.app import create_app
from companion.device import DeviceManager, SimulatedBackend
from companion.device import manager as manager_mod
from companion.eyedata import synthetic_eyes
from companion.session_record import SessionRecorder, dot_jumps, load_session

SRATE = 256.0


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def test_samples_between_reads_across_the_buffer_boundary(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(manager_mod.time, "monotonic", clock)
    m = DeviceManager(SimulatedBackend())
    n = int(SRATE)
    # 200 one-second chunks: more than the 180 s buffer, so it wraps; sample values count up.
    for i in range(200):
        clock.t += 1.0
        m._append(np.tile(np.arange(i * n, (i + 1) * n, dtype=float), (4, 1)))
    # Pull it back the way the recorder does, one second at a time, over the last 30 s.
    cursor, got = 1170.0, []
    for _ in range(30):
        t, eeg = m.samples_between(cursor, cursor + 1.0)
        cursor += 1.0
        got.append(eeg[0])
        assert len(t) == len(eeg[0]) and (np.diff(t) > 0).all()
    values = np.concatenate(got)
    assert len(values) == 30 * n
    assert (np.diff(values) == 1).all()          # no sample repeated or skipped between pulls
    assert values[-1] == 200 * n - 1
    # The start of the session has rolled out of the 180 s buffer.
    t, eeg = m.samples_between(1000.0, 1015.0)
    assert len(t) == 0 and eeg.shape == (4, 0)
    # eeg_between still answers as before.
    assert m.eeg_between(1199.5, 1200.0).shape[0] == 4


class FakeHeadset:
    """samples_between over a synthetic recording that 'arrives' as a clock advances."""

    def __init__(self, eeg, t0, clock):
        self.eeg, self.t0, self.clock = eeg, t0, clock
        self.times = t0 + np.arange(eeg.shape[1]) / SRATE

    def samples_between(self, a, b):
        keep = (self.times > a) & (self.times <= min(b, self.clock()))
        return self.times[keep], self.eeg[:, keep]


def test_recorder_saves_eeg_and_events_and_scores_the_dot_jumps(tmp_path):
    clock = Clock(500.0)
    # Dot jumps at known times, then blinks and clenches on cue, on one synthetic head (4 µV/degree).
    positions = [0, 5, -5, 10, -10, 15, 0, -15, 5, 15, -5, 10, 0]
    jumps = [(2.0 + 1.5 * i, float(b - a)) for i, (a, b) in enumerate(zip(positions, positions[1:]))]
    blink_t = [25.0, 27.5, 30.0, 32.5]
    clench_t = [(36.0, 37.0), (40.0, 41.0)]
    s = synthetic_eyes(45, seed=11, jumps=jumps, blinks=blink_t, clenches=clench_t)
    head = FakeHeadset(s.eeg, 500.0, clock)
    rec = SessionRecorder(head.samples_between, lambda: ["TP9", "AF7", "AF8", "TP10"], lambda: SRATE,
                          root=lambda: tmp_path, clock=clock)
    rec.start({"screen_mm": 302, "distance_mm": 600})
    with pytest.raises(Exception):
        rec.start({})
    clock.t = 501.0
    rec.event({"type": "dot", "x_deg": 0})
    for (tj, _), x in zip(jumps, positions[1:]):
        clock.t = 500.0 + tj
        rec.event({"type": "dot", "x_deg": x})
        rec.pull()
    for tb in blink_t:
        clock.t = 500.0 + tb - 0.3
        rec.event({"type": "cue", "what": "blink"})
    for t0, _ in clench_t:
        clock.t = 500.0 + t0
        rec.event({"type": "cue", "what": "clench"})
    clock.t = 545.0
    summary = rec.stop()
    assert not rec.active

    t, eeg, srate, events, meta = load_session(summary_path := tmp_path / summary["id"])
    assert eeg.shape[0] == 4 and eeg.shape[1] >= s.eeg.shape[1] - 2
    assert srate == pytest.approx(SRATE, rel=0.01)
    assert meta["screen_mm"] == 302 and meta["channels"] == ["TP9", "AF7", "AF8", "TP10"]
    assert [round(d) for _, d in dot_jumps(events)] == [round(d) for _, d in jumps]
    saved = json.loads((summary_path / "summary.json").read_text())
    assert saved == summary
    big = next(r for r in summary["dot_jumps"] if r["size_deg"] == "10-20")
    assert big["hits"] >= big["jumps"] - 1
    assert 3.0 <= summary["gain_uv_per_degree"] <= 5.0
    assert summary["blink_cues_caught"] == 4 and summary["clench_cues_caught"] == 2


def test_events_need_a_running_recording_and_a_type(tmp_path):
    rec = SessionRecorder(lambda a, b: (np.zeros(0), np.zeros((4, 0))), lambda: ["TP9", "AF7", "AF8", "TP10"],
                          lambda: SRATE, root=lambda: tmp_path)
    with pytest.raises(Exception):
        rec.event({"type": "dot"})
    rec.start({})
    with pytest.raises(Exception):
        rec.event({"no": "type"})
    summary = rec.stop()
    assert "note" in summary   # no EEG: says so instead of failing


def test_record_routes_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setenv("NEUROCHAT_DATA", str(tmp_path))
    with TestClient(create_app(SimulatedBackend())) as client:
        assert client.get("/api/record").json()["active"] is False
        with client.websocket_connect("/ws/record") as ws:
            ws.send_json({"type": "dot", "x_deg": 0})
            assert ws.receive_json()["type"] == "error"     # not recording yet
        r = client.post("/api/record/start", json={"screen_mm": 302})
        assert r.status_code == 200 and r.json()["active"]
        assert client.post("/api/record/start", json={}).status_code == 409
        with client.websocket_connect("/ws/record") as ws:
            ws.send_json({"type": "paragraph", "state": "show", "index": 0, "lines": [{"top": 1, "text": "a b"}]})
            ok = ws.receive_json()
            assert ok["type"] == "ok" and ok["t"] >= 0
            ws.send_json(["not", "an", "object"])
            assert ws.receive_json()["type"] == "error"
        time.sleep(0.05)
        summary = client.post("/api/record/stop").json()
        assert summary["events"] == 1
        assert client.post("/api/record/stop").status_code == 409
    folder = tmp_path / "sessions" / summary["id"]
    assert {p.name for p in folder.iterdir()} == {"meta.json", "eeg.csv", "events.jsonl", "summary.json"}


def test_record_page_is_served():
    with TestClient(create_app(SimulatedBackend())) as client:
        page = client.get("/record.html")
        assert page.status_code == 200 and "record.js" in page.text
        assert client.get("/record.js").status_code == 200
