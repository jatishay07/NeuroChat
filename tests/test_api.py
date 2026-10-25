import time

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
