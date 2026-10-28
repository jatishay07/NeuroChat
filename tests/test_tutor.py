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


def fake_openai(models=("my-model",), reply=("Main idea: ", "batteries ", "move ions."), key=None):
    """A stand-in for an OpenAI-compatible server at /v1 (LM Studio, vLLM, OpenAI...)."""
    chats = []

    def handler(request: httpx.Request) -> httpx.Response:
        if key and request.headers.get("authorization") != f"Bearer {key}":
            return httpx.Response(401, json={"error": "bad key"})
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": m} for m in models]})
        if request.url.path == "/v1/chat/completions":
            chats.append(json.loads(request.content))
            lines = [f"data: {json.dumps({'choices': [{'delta': {'content': t}}]})}" for t in reply]
            lines.append("data: [DONE]")
            return httpx.Response(200, content="\n\n".join(lines).encode())
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
    from companion.engagement import Calibration, reading
    from companion.tutor import reader_notes
    cal = Calibration(0.3, 1.2)
    assert reader_notes() == ""
    lost = reader_notes(46000, 23000, rereads=2, engagement=reading(0.35, cal, "while they read this paragraph"))
    assert "46 s per 100 words, 2.0× their usual pace" in lost
    assert "went back to this paragraph 2 times" in lost and "rereading" in lost
    assert "EEG engagement while they read this paragraph: 0.05" in lost and "LOW band" in lost
    assert "lost them rather than challenged them" in lost and "under 80 words" in lost
    focused = reader_notes(46000, 23000, engagement=reading(1.1, cal, "right now"))
    assert "HIGH band" in focused and "content itself is hard" in focused and "went back" not in focused
    assert "Never mention or hint at them" in focused


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


def real_headset_app(ollama, eeg=None):
    """An app whose simulated headset stands in for a real Athena, optionally with EEG already buffered."""
    app = create_app(SimulatedBackend(), Tutor(transport=ollama))
    app.state.device.state = "streaming"
    app.state.device.backend.simulated = False
    if eeg is not None:
        app.state.device._append(eeg)
    return app


def test_real_headset_engagement_reaches_the_prompt():
    from companion.gaze import Visit
    ollama = fake_ollama()
    app = real_headset_app(ollama)
    app.state.engagement.set(0.3, 1.2)
    app.state.gaze.visits = [Visit(0, 0, 10, 0.75), Visit(1, 10, 20, 1.15), Visit(2, 20, 40, 0.35), Visit(2, 45, 50, 0.35)]
    with TestClient(app) as client, client.websocket_connect("/ws/chat") as ws:
        chat_turn(ws, {"type": "explain", "paragraph": "x", "index": 2})
        system = ollama.chats[-1]["messages"][0]["content"]
        assert "EEG engagement while they read this paragraph: 0.05" in system and "LOW band" in system
        assert "against their own relaxed and focused calibration" in system
        assert "went back to this paragraph 1 time." in system
        chat_turn(ws, {"type": "explain", "paragraph": "y", "index": 1, "append": True})
        system = ollama.chats[-1]["messages"][0]["content"]  # an appended passage gets its own numbers
        assert "HIGH band" in system and "LOW band" not in system and "went back" not in system
        chat_turn(ws, {"type": "explain", "paragraph": "z", "index": 0})
        assert "MODERATE band" in ollama.chats[-1]["messages"][0]["content"]


def test_follow_ups_and_unindexed_passages_get_the_live_score():
    from companion.synthetic import synthetic_eeg
    ollama = fake_ollama()
    app = real_headset_app(ollama, synthetic_eeg(0.05, 20, seed=4))
    app.state.engagement.set(0.3, 1.2)
    with TestClient(app) as client, client.websocket_connect("/ws/chat") as ws:
        chat_turn(ws, {"type": "explain", "paragraph": "Selected on a web page", "rereads": 0})
        system = ollama.chats[-1]["messages"][0]["content"]
        assert "EEG engagement over the last 15 seconds" in system and "LOW band" in system
        app.state.device._append(synthetic_eeg(1.0, 20, seed=5))
        chat_turn(ws, {"type": "ask", "text": "Why?"})
        system = ollama.chats[-1]["messages"][0]["content"]
        assert "over the last 15 seconds" in system and "HIGH band" in system
        assert client.get("/api/engagement").json()["now"]["bucket"] == "high"


def test_engagement_without_calibration_is_relative_to_the_reading():
    import numpy as np
    from companion.synthetic import synthetic_eeg
    ollama = fake_ollama()
    levels = [0.9] * 60 + [0.1] * 20
    app = real_headset_app(ollama, synthetic_eeg(levels, 80, seed=6))
    with TestClient(app) as client, client.websocket_connect("/ws/chat") as ws:
        chat_turn(ws, {"type": "ask", "text": "Explain entropy"})
        system = ollama.chats[-1]["messages"][0]["content"]
        assert system.startswith("You are a patient tutor. The person is reading")
        assert "relative to the rest of this reading; no calibration was done" in system and "LOW band" in system
    assert np.isfinite(app.state.engagement.now().raw)


def test_calibration_api():
    import time as _time
    from companion.synthetic import synthetic_eeg
    ollama = fake_ollama()
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=ollama))) as client:
        assert client.post("/api/engagement/calibration/relax/start").status_code == 409  # no headset yet
        app = client.app
        app.state.device.state = "streaming"
        app.state.device.backend.simulated = False
        assert client.post("/api/engagement/calibration/sleep/start").status_code == 404
        assert client.post("/api/engagement/calibration/task/finish").status_code == 409  # never started
        for phase, level in (("relax", 0.05), ("task", 0.95)):
            client.post(f"/api/engagement/calibration/{phase}/start")
            app.state.engagement._recording[phase] = _time.monotonic() - 1   # as if it started 1 s ago...
            app.state.device._filled = 0                                     # (only this phase's EEG in the buffer)
            app.state.device._append(synthetic_eeg(level, 30, seed=8))       # ...and 30 s arrived since
            app.state.engagement._recording[phase] -= 30
            st = client.post(f"/api/engagement/calibration/{phase}/finish").json()
        assert st["calibrated"] and st["bounds"]["relax"] < 0.4 < 0.8 < st["bounds"]["task"]
        assert [b["name"] for b in st["buckets"]] == ["low", "moderate", "high"]
        assert client.put("/api/engagement/calibration", json={"e_min": 1, "e_max": 0.5}).status_code == 422
        assert client.put("/api/engagement/calibration", json={"e_min": 0.3, "e_max": 1.2}).json()["bounds"] == {"relax": 0.3, "task": 1.2}
        assert client.delete("/api/engagement/calibration").json()["calibrated"] is False


def test_explain_mentions_rereads():
    from companion.tutor import explain_request
    assert "reread it 3 times" in explain_request("x", "T", rereads=3)
    assert "reread" not in explain_request("x", "T", rereads=0)


def test_load_restores_a_conversation_and_explain_can_append():
    ollama = fake_ollama()
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=ollama))) as client:
        with client.websocket_connect("/ws/chat") as ws:
            ws.send_json({"type": "load", "mode": "chat", "messages": [
                {"role": "user", "content": "What is an anode?"}, {"role": "assistant", "content": "The minus side."},
                {"role": "system", "content": "ignored"}]})
            assert ws.receive_json() == {"type": "loaded"}
            chat_turn(ws, {"type": "explain", "paragraph": "Intercalation", "append": True})
            chat_turn(ws, {"type": "explain", "paragraph": "Overpotential"})  # no append: starts over
    first, second = ollama.chats
    assert [m["role"] for m in first["messages"]] == ["system", "user", "assistant", "user"]
    assert first["messages"][0]["content"].startswith("You are a patient tutor. The person is reading")
    assert "Intercalation" in first["messages"][3]["content"]
    assert [m["role"] for m in second["messages"]] == ["system", "user"]


def test_openai_compatible_server():
    server = fake_openai(key="sk-test")
    tutor = Tutor(model="my-model", transport=server, openai_url="http://llm.local/v1", api_key="sk-test")
    with TestClient(create_app(SimulatedBackend(), tutor)) as client:
        assert client.get("/api/tutor").json()["ready"] is True
        with client.websocket_connect("/ws/chat") as ws:
            events = chat_turn(ws, {"type": "explain", "paragraph": "Intercalation into graphite..."})
            assert "".join(e.get("text", "") for e in events) == "Main idea: batteries move ions."
    (body,) = server.chats
    assert body["model"] == "my-model" and body["stream"] is True
    assert body["messages"][0]["role"] == "system" and "think" not in body


def test_openai_compatible_server_problems_are_explained():
    wrong_key = Tutor(model="my-model", transport=fake_openai(key="right"), openai_url="http://llm.local/v1", api_key="x")
    missing = Tutor(model="other", transport=fake_openai(), openai_url="http://llm.local/v1")
    for tutor, says in ((wrong_key, "API key"), (missing, "no model called other")):
        s = TestClient(create_app(SimulatedBackend(), tutor)).get("/api/tutor").json()
        assert s["ready"] is False and says in s["error"]
