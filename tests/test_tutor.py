import json

import httpx
from fastapi.testclient import TestClient

from companion.app import create_app
from companion.device import SimulatedBackend
from companion.tutor import Tutor


def fake_ollama(models=("qwen3.5:4b",), reply=("Main idea: ", "batteries ", "move ions."), down=False):
    """A stand-in for Ollama's HTTP API. Records every /api/chat request body in .chats."""
    chats = []

    def handler(request: httpx.Request) -> httpx.Response:
        if down:
            raise httpx.ConnectError("refused", request=request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m} for m in models]})
        if request.url.path == "/api/chat":
            body = json.loads(request.content)
            chats.append(body)
            if body["model"] not in models:
                return httpx.Response(404, json={"error": "model not found"})
            lines = [json.dumps({"message": {"content": t}, "done": False}) for t in reply]
            lines.append(json.dumps({"message": {"content": ""}, "done": True}))
            return httpx.Response(200, content="\n".join(lines).encode())
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    transport.chats = chats
    return transport


def chat_turn(ws, msg):
    ws.send_json(msg)
    events = []
    while True:
        e = ws.receive_json()
        events.append(e)
        if e["type"] in ("done", "error"):
            return events


def test_status_ready_and_missing_model():
    ok = TestClient(create_app(SimulatedBackend(), Tutor(transport=fake_ollama())))
    assert ok.get("/api/tutor").json()["ready"] is True
    missing = TestClient(create_app(SimulatedBackend(), Tutor(transport=fake_ollama(models=()))))
    s = missing.get("/api/tutor").json()
    assert s["ready"] is False and "isn't downloaded" in s["error"]
    down = TestClient(create_app(SimulatedBackend(), Tutor(transport=fake_ollama(down=True))))
    assert "isn't running" in down.get("/api/tutor").json()["error"]


def test_explain_streams_and_follow_up_keeps_history():
    ollama = fake_ollama()
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=ollama))) as client:
        with client.websocket_connect("/ws/chat") as ws:
            events = chat_turn(ws, {"type": "explain", "paragraph": "Intercalation into graphite...", "title": "Batteries"})
            assert [e["type"] for e in events] == ["start", "token", "token", "token", "done"]
            assert "".join(e.get("text", "") for e in events) == "Main idea: batteries move ions."
            chat_turn(ws, {"type": "ask", "text": "What is an anode?"})
    first, second = ollama.chats
    assert first["messages"][0]["role"] == "system" and first["think"] is False
    assert "Intercalation into graphite" in first["messages"][1]["content"]
    # The follow-up carries the paragraph, the tutor's first answer and the new question.
    assert [m["role"] for m in second["messages"]] == ["system", "user", "assistant", "user"]
    assert second["messages"][2]["content"] == "Main idea: batteries move ions."


def test_errors_are_reported_not_raised():
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=fake_ollama(down=True)))) as client:
        with client.websocket_connect("/ws/chat") as ws:
            events = chat_turn(ws, {"type": "explain", "paragraph": "x"})
            assert events[-1]["type"] == "error" and "isn't running" in events[-1]["message"]
            assert chat_turn(ws, {"type": "nonsense"})[-1]["type"] == "error"


def test_explain_a_selection_with_its_paragraph():
    ollama = fake_ollama()
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=ollama))) as client:
        with client.websocket_connect("/ws/chat") as ws:
            chat_turn(ws, {"type": "explain", "paragraph": "Gibbs free energy", "title": "Batteries",
                           "context": "The potential arises from the disparity in Gibbs free energy of lithium."})
    asked = ollama.chats[0]["messages"][1]["content"]
    assert '"""Gibbs free energy"""' in asked and "It's from this paragraph" in asked and "disparity" in asked


def test_reader_notes_turn_signals_into_advice():
    from companion.tutor import reader_notes
    assert reader_notes() == ""
    lost = reader_notes(46000, 23000, rereads=2, engagement=0.36, median_engagement=0.6)
    assert "46 s per 100 words, 2.0× their usual pace" in lost
    assert "went back to this paragraph 2 times" in lost and "rereading" in lost
    assert "attention dropped" in lost and "60% of usual" in lost
    focused = reader_notes(46000, 23000, engagement=0.62, median_engagement=0.6)
    assert "content itself is hard" in focused and "went back" not in focused


def test_explain_puts_reading_signals_in_the_system_prompt():
    ollama = fake_ollama()
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=ollama))) as client:
        with client.websocket_connect("/ws/chat") as ws:
            chat_turn(ws, {"type": "explain", "paragraph": "Intercalation...", "index": 2,
                           "dwellMsPer100Words": 46000, "medianMsPer100Words": 23000, "rereads": 1})
            system = ollama.chats[-1]["messages"][0]["content"]
            assert "2.0× their usual pace" in system and "went back to this paragraph 1 time." in system
            # The simulated headset's EEG is noise, so its engagement never reaches the model.
            assert "EEG engagement" not in system
            chat_turn(ws, {"type": "explain", "paragraph": "No numbers here"})
            assert "measured" not in ollama.chats[-1]["messages"][0]["content"]


def test_real_headset_engagement_reaches_the_prompt():
    from companion.gaze import Visit
    ollama = fake_ollama()
    app = create_app(SimulatedBackend(), Tutor(transport=ollama))
    app.state.device.state = "streaming"
    app.state.device.backend.simulated = False  # stand in for a real Athena
    app.state.gaze.visits = [Visit(0, 0, 10, 0.6), Visit(1, 10, 20, 0.6), Visit(2, 20, 40, 0.3), Visit(2, 45, 50, 0.3)]
    with TestClient(app) as client, client.websocket_connect("/ws/chat") as ws:
        chat_turn(ws, {"type": "explain", "paragraph": "x", "index": 2})
        system = ollama.chats[-1]["messages"][0]["content"]
        assert "EEG engagement here: 0.30, against 0.60" in system and "attention dropped" in system
        assert "went back to this paragraph 1 time." in system
