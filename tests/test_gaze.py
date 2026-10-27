import time

import numpy as np
from fastapi.testclient import TestClient

from companion.app import create_app
from companion.device import SimulatedBackend
from companion.engagement import engagement_index
from companion.gaze import GazeSession

SRATE = 256.0


def sine(freq, seconds=4.0, amp=10.0):
    t = np.arange(int(seconds * SRATE)) / SRATE
    return np.tile(amp * np.sin(2 * np.pi * freq * t), (4, 1))


def test_engagement_index_is_high_for_beta_and_low_for_alpha():
    beta, alpha = engagement_index(sine(15), SRATE), engagement_index(sine(9), SRATE)
    assert beta > 10 and alpha < 0.1
    assert engagement_index(sine(15, seconds=0.5), SRATE) is None  # too short


class FakeClock:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        return self.t


def test_visits_line_up_with_eeg_between_their_times():
    clock, asked = FakeClock(), []

    def eeg_between(t0, t1):
        asked.append((t0, t1))
        return sine(15, seconds=t1 - t0)

    s = GazeSession(eeg_between, lambda: SRATE, clock)
    assert s.enter(0) is None
    clock.t += 3
    v = s.enter(1)                     # moving on closes the first visit
    assert (v.paragraph, v.seconds) == (0, 3) and asked == [(100, 103)] and v.engagement > 10
    clock.t += 0.1
    assert s.enter(0) is None          # a 0.1 s glance at paragraph 1 doesn't count
    clock.t += 2
    s.leave()
    rows = s.summary()["paragraphs"]
    assert [(r["paragraph"], r["seconds"], r["visits"]) for r in rows] == [(0, 5.0, 2)]


def test_no_headset_means_no_engagement():
    clock = FakeClock()
    s = GazeSession(lambda a, b: np.zeros((4, 0)), lambda: SRATE, clock)
    s.enter(2)
    clock.t += 4
    assert s.leave().engagement is None
    assert s.summary() == {"paragraphs": [{"paragraph": 2, "seconds": 4.0, "visits": 1, "engagement": None}],
                           "median_engagement": None}


def test_gaze_websocket_with_simulated_headset():
    with TestClient(create_app(SimulatedBackend())) as client:
        client.post("/api/device/scan", params={"timeout": 1})
        client.post("/api/device/connect", json={"address": "SIM-0001"})
        deadline = time.time() + 5
        while time.time() < deadline and client.get("/api/device").json()["state"] != "streaming":
            time.sleep(0.1)
        with client.websocket_connect("/ws/gaze") as ws:
            ws.send_json({"type": "enter", "paragraph": 1})
            time.sleep(1.5)
            ws.send_json({"type": "leave"})
            visit = ws.receive_json()
            assert visit["type"] == "visit" and visit["paragraph"] == 1 and visit["seconds"] >= 1.4
            assert visit["engagement"] is not None and visit["engagement"] > 0
            ws.send_json({"type": "nope"})
            assert ws.receive_json()["type"] == "error"
        summary = client.get("/api/gaze").json()
        assert summary["paragraphs"][0]["paragraph"] == 1 and summary["median_engagement"] is not None
