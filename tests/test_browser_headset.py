from pathlib import Path
import time

from fastapi.testclient import TestClient

from companion.app import create_app
from companion.device import BrowserHeadset
from companion.device import SimulatedBackend

# A few seconds of raw Bluetooth notifications from a Muse S Athena (preset
# p1041), from OpenMuse's public test data (tests/test_data/data_p1041.txt).
LINES = (
    (Path(__file__).parent / "fixtures" / "athena_p1041.txt")
    .read_text()
    .splitlines()
)
PACKETS = [line.split("\t")[1:3] for line in LINES]


def test_decodes_eeg_from_raw_packets():
    h = BrowserHeadset()
    h.feed(PACKETS + [["273e0013-4c4d-454d-96be-f03bac821358", "zz"], "junk"])
    eeg = h.read()
    assert eeg.shape[0] == 4 and eeg.shape[1] > 500
    assert h.read().shape[1] == 0


def wait_for(client, pred, seconds=5):
    deadline = time.time() + seconds
    while time.time() < deadline:
        s = client.get("/api/device").json()
        if pred(s):
            return s
        time.sleep(0.05)
    raise AssertionError(f"timed out; last status {s}")


def test_browser_session_streams_then_disconnects():
    with TestClient(create_app(SimulatedBackend())) as client:
        assert client.get("/api/device").json()["simulated"] is True
        with client.websocket_connect("/ws/headset") as ws:
            ws.send_json({"type": "hello", "name": "Muse-S-1234"})
            for i in range(0, len(PACKETS), 10):
                ws.send_json({"type": "data", "packets": PACKETS[i : i + 10]})
            s = wait_for(client, lambda s: s["state"] == "streaming")
            assert s["device"] == {
                "name": "Muse-S-1234",
                "address": "browser",
                "rssi": None,
            }
        s = wait_for(client, lambda s: s["state"] == "idle")
        assert s["device"] is None
        # The simulated headset is back for the next connection.
        assert (
            client.post("/api/device/scan", params={"timeout": 1}).json()[
                "devices"
            ][0]["address"]
            == "SIM-0001"
        )


def test_lost_bluetooth_shows_the_reason():
    with TestClient(create_app(SimulatedBackend())) as client:
        with client.websocket_connect("/ws/headset") as ws:
            ws.send_json({"type": "hello", "name": "Muse"})
            ws.send_json(
                {"type": "lost", "message": "The headset disconnected."}
            )
        s = wait_for(client, lambda s: s["state"] == "error")
        assert s["error"] == "The headset disconnected."


def test_portal_disconnect_ends_the_browser_session():
    with TestClient(create_app(SimulatedBackend())) as client:
        with client.websocket_connect("/ws/headset") as ws:
            ws.send_json({"type": "hello", "name": "Muse"})
            ws.send_json({"type": "data", "packets": PACKETS[:40]})
            wait_for(client, lambda s: s["state"] == "streaming")
            assert (
                client.post("/api/device/disconnect").json()["state"] == "idle"
            )
            ws.send_json({"type": "data", "packets": PACKETS[40:50]})
            assert ws.receive()["type"] == "websocket.close"
