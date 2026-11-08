import json
import time

from fastapi.testclient import TestClient
import httpx
from test_tutor import chat_turn
from test_tutor import fake_ollama

from companion.app import create_app
from companion.device import SimulatedBackend
from companion.tutor import Tutor
from companion.webui import build_chat
from companion.webui import TUTOR_ID
from companion.webui import WebUI


def fake_webui(down=False, auth_required=False):
    """A stand-in for Open WebUI's API. Records models and chats it was sent."""
    state = {"models": {}, "chats": []}

    def handler(request: httpx.Request) -> httpx.Response:
        if down:
            raise httpx.ConnectError("refused", request=request)
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": True})
        if path == "/api/v1/auths/signin":
            return (
                httpx.Response(400, json={"detail": "bad"})
                if auth_required
                else httpx.Response(200, json={"token": "t"})
            )
        if request.headers.get("authorization") != "Bearer t":
            return httpx.Response(401)
        if path == "/api/v1/models/model":
            m = state["models"].get(request.url.params["id"])
            return (
                httpx.Response(200, json=m)
                if m
                else httpx.Response(401, json={"detail": "not found"})
            )
        if path in ("/api/v1/models/create", "/api/v1/models/model/update"):
            form = json.loads(request.content)
            state["models"][form["id"]] = form
            return httpx.Response(200, json=form)
        if path == "/api/v1/chats/new":
            state["chats"].append(json.loads(request.content)["chat"])
            return httpx.Response(
                200, json={"id": f"chat{len(state['chats'])}"}
            )
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    transport.state = state
    return transport


def app_with(webui_transport, public_url=None):
    tutor = Tutor(transport=fake_ollama())
    webui = WebUI(
        base_url="http://webui",
        model=tutor.model,
        transport=webui_transport,
        public_url=public_url,
    )
    return TestClient(
        create_app(SimulatedBackend(), tutor, webui), follow_redirects=False
    )


def test_build_chat_links_messages_in_order():
    chat = build_chat(
        [
            {"role": "user", "content": "q"},
            {"role": "assistant", "content": "a"},
        ],
        "T",
    )
    first, second = chat["messages"]
    assert first["parentId"] is None and first["childrenIds"] == [second["id"]]
    assert second["parentId"] == first["id"] and second["model"] == TUTOR_ID
    assert chat["history"]["currentId"] == second["id"] and set(
        chat["history"]["messages"]
    ) == {first["id"], second["id"]}


def test_continue_copies_the_conversation_into_open_webui():
    webui = fake_webui()
    with (
        app_with(webui, public_url="http://127.0.0.1:3000") as client,
        client.websocket_connect("/ws/chat") as ws,
    ):
        chat_turn(
            ws,
            {
                "type": "explain",
                "paragraph": "Intercalation into graphite...",
                "title": "Batteries",
            },
        )
        ws.send_json({"type": "continue"})
        assert ws.receive_json() == {
            "type": "continued",
            "url": "http://127.0.0.1:3000/c/chat1",
        }
    (chat,) = webui.state["chats"]
    assert [m["role"] for m in chat["messages"]] == ["user", "assistant"]
    assert "Intercalation" in chat["messages"][0]["content"] and chat[
        "title"
    ].startswith("Explaining: Intercalation")
    tutor = webui.state["models"][TUTOR_ID]
    assert tutor["base_model_id"] == "qwen3.5:4b" and tutor["params"]["system"]
    assert (
        tutor["meta"]["capabilities"]["builtin_tools"] is False
        and tutor["params"]["think"] is False
    )
    plain = webui.state["models"]["qwen3.5:4b"]
    assert (
        plain["meta"]["capabilities"]["builtin_tools"] is False
        and plain["params"]["think"] is False
    )


def test_chat_route_opens_the_glass_chat_page():
    # /chat is always NeuroChat's own page; Open WebUI is reached from it via
    # "Continue in Open WebUI".
    with app_with(fake_webui()) as client:
        r = client.get("/chat")
        assert r.status_code == 307 and r.headers["location"] == "/chat.html"
        assert client.get("/api/webui").json()["ready"] is True
    with app_with(fake_webui(down=True)) as client:
        assert client.get("/chat").headers["location"] == "/chat.html"
        assert client.get("/api/webui").json()["ready"] is False


def test_continue_reports_when_open_webui_is_down():
    with (
        app_with(fake_webui(down=True)) as client,
        client.websocket_connect("/ws/chat") as ws,
    ):
        chat_turn(ws, {"type": "ask", "text": "What is an anode?"})
        ws.send_json({"type": "continue"})
        e = ws.receive_json()
        assert (
            e["type"] == "error" and "Open WebUI isn't running" in e["message"]
        )


def test_models_are_set_up_at_startup():
    webui = fake_webui()
    with app_with(webui):
        for _ in range(50):
            if "qwen3.5:4b" in webui.state["models"]:
                break
            time.sleep(0.05)
    assert {TUTOR_ID, "qwen3.5:4b"} <= set(webui.state["models"])
