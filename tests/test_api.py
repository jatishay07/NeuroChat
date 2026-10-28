import time

import pytest
from fastapi.testclient import TestClient

from companion.app import create_app
from companion.device import SimulatedBackend


def test_connect_flow_over_http_and_websocket():
    with TestClient(create_app(SimulatedBackend())) as client:
        assert client.get("/api/device").json()["state"] == "idle"
        s = client.post("/api/device/scan", params={"timeout": 1}).json()
        assert s["devices"][0]["address"] == "SIM-0001"
        with client.websocket_connect("/ws/device") as ws:
            assert ws.receive_json()["state"] == "idle"
            client.post("/api/device/connect", json={"address": "SIM-0001"})
            deadline = time.time() + 5
            seen = set()
            while time.time() < deadline and "streaming" not in seen:
                seen.add(ws.receive_json()["state"])
            assert "streaming" in seen
        assert client.post("/api/device/disconnect").json()["state"] == "idle"


def test_bad_connect_returns_409():
    with TestClient(create_app(SimulatedBackend())) as client:
        r = client.post("/api/device/connect", json={"address": "NOPE"})
        assert r.status_code == 409


def test_portal_is_served():
    with TestClient(create_app(SimulatedBackend())) as client:
        r = client.get("/")
        assert r.status_code == 200 and "Connect your headset" in r.text
        r = client.get("/eyes.html")
        assert r.status_code == 200 and "Calibrate eye tracking" in r.text


def test_streaming_status_carries_a_live_waveform():
    with TestClient(create_app(SimulatedBackend())) as client:
        client.post("/api/device/scan", params={"timeout": 1})
        assert client.get("/api/device").json()["wave"] is None
        with client.websocket_connect("/ws/device") as ws:
            client.post("/api/device/connect", json={"address": "SIM-0001"})
            deadline, wave = time.time() + 5, None
            while time.time() < deadline and not (wave and len(wave[0]) == 60):
                wave = ws.receive_json()["wave"]
        assert len(wave) == 4 and all(len(ch) == 60 for ch in wave)
        assert all(abs(sum(ch) / 60) < 1 for ch in wave)  # centred on 0


def test_other_websites_and_host_names_are_refused():
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(create_app(SimulatedBackend()))
    assert client.get("/api/device", headers={"Origin": "http://127.0.0.1:3000"}).status_code == 200
    assert client.get("/api/device", headers={"Origin": "chrome-extension://abc"}).status_code == 200
    assert client.get("/api/device", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/device/disconnect", headers={"Origin": "https://evil.example"}).status_code == 403
    # DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends its own Host.
    assert client.get("/api/device", headers={"Host": "evil.example:8765"}).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/chat", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_json()
    with client.websocket_connect("/ws/device", headers={"Origin": "http://localhost:8765"}) as ws:
        assert ws.receive_json()
