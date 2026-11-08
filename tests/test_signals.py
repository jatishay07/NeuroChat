"""The signals page: what the headset recorded and what the tutor was told.

The companion side (band powers, waves, the prompt endpoints, replaying
recordings) is tested here directly; the extension page itself runs in Chromium
with Playwright when Node and Playwright are installed.
"""

import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time

from fastapi.testclient import TestClient
import numpy as np
import pytest
from test_study import _has_playwright
from test_study import _node_path
from test_tutor import chat_turn
from test_tutor import fake_ollama
import uvicorn
from websockets.sync.client import connect as ws_connect

from companion.app import create_app
from companion.device import SimulatedBackend
from companion.engagement import signal_view
from companion.recording import Recording
from companion.recording import RecordingBackend
from companion.recording import replay_backend
from companion.recording import save_csv
from companion.synthetic import synthetic_eeg
from companion.tutor import Tutor

ROOT = Path(__file__).resolve().parent.parent
SRATE = 256.0


def sine(freq, seconds, amp=10.0):
    t = np.arange(int(seconds * SRATE)) / SRATE
    return np.tile(800 + amp * np.sin(2 * np.pi * freq * t), (4, 1))


def test_signal_view_per_second_bands_and_waves():
    v = signal_view(sine(9, 30), SRATE, seconds=20)
    assert len(v["seconds"]) == 20 and v["seconds"][-1] == 0.0
    i = -1
    assert (
        v["alpha"][i] > 50 * v["beta"][i] and v["alpha"][i] > 50 * v["theta"][i]
    )
    # A full 15 s window from second 15 of the recording on (the view starts at 11).
    assert (
        v["engagement"][i] < 0.1
        and v["engagement"][3] is None
        and v["engagement"][4] is not None
    )
    alpha, beta = np.array(v["waves"]["alpha"]), np.array(v["waves"]["beta"])
    assert v["waves"]["rate"] == 64 and len(alpha) == 256
    assert 8 < np.abs(alpha).max() < 12 and np.abs(beta).max() < 2
    # The first 15 s have no full window yet.
    short = signal_view(sine(15, 10), SRATE)
    assert (
        short["engagement"][-1] is not None
    )  # whole-recording index under 15 s
    assert short["beta"][-1] > short["alpha"][-1]


def streaming_app(ollama, eeg=None, backend=None):
    app = create_app(backend or SimulatedBackend(), Tutor(transport=ollama))
    app.state.device.state = "streaming"
    if eeg is not None:
        app.state.device.backend.synthetic_eeg = True
        app.state.device._append(eeg)
    return app


def test_signals_endpoint():
    ollama = fake_ollama()
    with TestClient(
        create_app(SimulatedBackend(), Tutor(transport=ollama))
    ) as c:
        d = c.get("/api/engagement/signals").json()
        assert d == {
            "state": "idle",
            "source": None,
            "reaches_tutor": False,
            "signals": None,
        }
    app = streaming_app(
        ollama, synthetic_eeg([0.1] * 30 + [0.9] * 30, 60, seed=3)
    )
    app.state.engagement.set(0.3, 1.2)
    with TestClient(app) as c:
        d = c.get("/api/engagement/signals", params={"seconds": 40}).json()
    s = d["signals"]
    assert d["reaches_tutor"] and len(s["seconds"]) == 40 and s["calibrated"]
    assert s["now"]["bucket"] in ("moderate", "high") and s["score"][
        -1
    ] == pytest.approx(s["now"]["score"], abs=0.05)
    assert s["score"][0] < s["score"][-1]  # engagement rose over the recording
    assert s["bands_hz"] == {
        "theta": [4.0, 7.0],
        "alpha": [7.0, 11.0],
        "beta": [11.0, 20.0],
    }


def test_plain_simulated_noise_is_drawn_but_flagged():
    app = streaming_app(fake_ollama())
    app.state.device._append(synthetic_eeg(0.5, 20, seed=1))
    with TestClient(app) as c:
        d = c.get("/api/engagement/signals").json()
    assert d["signals"] is not None and d["reaches_tutor"] is False


def test_prompt_endpoint_shows_last_sent_and_what_now_would_send():
    ollama = fake_ollama()
    app = streaming_app(ollama, synthetic_eeg(0.05, 20, seed=4))
    app.state.engagement.set(0.3, 1.2)
    with TestClient(app) as c:
        first = c.get("/api/engagement/prompt").json()
        assert first["last"] is None and "LOW band" in first["preview"]
        with c.websocket_connect("/ws/chat") as ws:
            chat_turn(ws, {"type": "explain", "paragraph": "Gibbs free energy"})
        d = c.get("/api/engagement/prompt").json()
    assert d["last"]["system"] == ollama.chats[-1]["messages"][0]["content"]
    assert d["last"]["turn"] == "explain" and "LOW band" in d["last"]["system"]


def test_recording_backend_plays_parts_in_order_and_loops():
    import asyncio

    a = Recording(np.zeros((4, 512)), SRATE, ["TP9", "AF7", "AF8", "TP10"])
    b = Recording(np.ones((4, 256)), SRATE, ["TP9", "AF7", "AF8", "TP10"])
    backend = RecordingBackend([("calm", a), ("focused", b)])
    assert backend.srate == SRATE and backend.data.shape == (4, 768)
    assert backend.playing() is None
    asyncio.run(backend.connect("REPLAY"))
    assert backend.playing() == "calm"
    backend._t0 -= 2.5  # 640 samples in: inside "focused"
    chunk = backend.read()
    assert chunk.shape == (4, 640) and backend.playing() == "focused"
    backend._t0 -= 1.0  # past the end: loops back to the start
    backend.read()
    assert backend.playing() == "calm"
    with pytest.raises(Exception, match="No recording"):
        asyncio.run(backend.connect("SIM-0001"))
    with pytest.raises(ValueError):
        RecordingBackend(
            [("x", a), ("y", Recording(np.zeros((4, 10)), 128.0, []))]
        )


def test_replay_starts_by_itself_and_reaches_the_tutor(tmp_path):
    save_csv(tmp_path / "calm.csv", synthetic_eeg(0.1, 20, seed=1), SRATE)
    save_csv(tmp_path / "focused.csv", synthetic_eeg(0.9, 20, seed=2), SRATE)
    backend = replay_backend(
        f"{tmp_path / 'calm.csv'},{tmp_path / 'focused.csv'}"
    )
    backend.calibration = (0.3, 1.2)
    with TestClient(create_app(backend, Tutor(transport=fake_ollama()))) as c:
        deadline = time.time() + 5
        while (
            c.get("/api/device").json()["state"] != "streaming"
            and time.time() < deadline
        ):
            time.sleep(0.05)
        d = c.get("/api/engagement/signals").json()
        assert (
            d["state"] == "streaming"
            and d["source"] == "calm"
            and d["reaches_tutor"]
        )
        assert c.get("/api/engagement").json()["calibrated"]


def _port_free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            return False
        return True


@pytest.mark.skipif(
    not _has_playwright(), reason="needs Node and Playwright with Chromium"
)
@pytest.mark.skipif(
    not _port_free(8765),
    reason="the page talks to 127.0.0.1:8765, which is in use",
)
def test_signals_page_in_the_extension(tmp_path):
    parts = [
        (
            "Synthetic, calm",
            Recording(synthetic_eeg(0.1, 40, seed=1), SRATE, []),
        ),
        (
            "Synthetic, focused",
            Recording(synthetic_eeg(0.9, 40, seed=2), SRATE, []),
        ),
    ]
    backend = RecordingBackend(parts)
    backend.calibration = (0.3, 1.2)
    ollama = fake_ollama()
    app = create_app(backend, Tutor(transport=ollama))
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=8765, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        time.sleep(
            16
        )  # a full 15 s window, so the explain below carries a score
        with ws_connect("ws://127.0.0.1:8765/ws/chat") as ws:
            ws.send(
                json.dumps(
                    {
                        "type": "explain",
                        "paragraph": "Overpotential is the extra voltage...",
                    }
                )
            )
            while json.loads(ws.recv(timeout=10))["type"] not in (
                "done",
                "error",
            ):
                pass
        out = os.environ.get("SIGNALS_SCREENSHOTS") or str(tmp_path)
        args = [
            shutil.which("node"),
            "tests/signals/browser.mjs",
            out,
            "Synthetic",
        ]
        if os.environ.get("SIGNALS_VIDEO"):
            args.append("--video")
        r = subprocess.run(
            args,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=180,
            env={**os.environ, "NODE_PATH": _node_path()},
        )
        assert r.returncode == 0, r.stdout + r.stderr
        seen = json.loads(r.stdout.strip().splitlines()[-1])
        assert seen["ok"] and seen["alphaHz"] == "7–11 Hz"
        assert seen["bucket"] in ("low", "moderate", "high")
    finally:
        server.should_exit = True
        thread.join(timeout=5)
