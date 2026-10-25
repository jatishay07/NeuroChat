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
