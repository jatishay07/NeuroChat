"""Study mode (milestone 1, S1–S8). The pace logic is plain JavaScript (portal/study-pace.js), so its unit
tests run under Node; the page itself is checked in Chromium with Playwright against the real companion
and a stand-in tutor. Both skip when Node or Playwright isn't installed."""
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from companion.app import create_app
from companion.device import SimulatedBackend
from companion.tutor import Tutor

from test_tutor import fake_ollama

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")


def test_study_page_is_served_and_linked_from_home():
    with TestClient(create_app(SimulatedBackend())) as client:
        page = client.get("/study.html")
        assert page.status_code == 200 and "Study mode" in page.text
        for asset in ("study.js", "study-pace.js", "study.css"):
            assert f'"{asset}"' in page.text
            assert client.get(f"/{asset}").status_code == 200
        assert 'href="/study.html"' in client.get("/").text


def test_study_page_needs_no_camera_or_headset():
    js = (ROOT / "portal/study.js").read_text() + (ROOT / "portal/study.html").read_text()
    for hardware in ("getUserMedia", "/ws/gaze", "/ws/headset", "/ws/device", "bluetooth"):
        assert hardware not in js


@pytest.mark.skipif(not NODE, reason="needs Node")
def test_pace_unit_tests():
    r = subprocess.run([NODE, "--test", "tests/study/pace.test.mjs"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr


def _has_playwright() -> bool:
    if not NODE:
        return False
    r = subprocess.run([NODE, "-e", "require('playwright')"], cwd=ROOT, capture_output=True,
                       env={**os.environ, "NODE_PATH": _node_path()})
    return r.returncode == 0


def _node_path() -> str:
    root = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True).stdout.strip() if shutil.which("npm") else ""
    return os.pathsep.join(p for p in (os.environ.get("NODE_PATH", ""), root) if p)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.skipif(not _has_playwright(), reason="needs Node and Playwright with Chromium")
def test_study_mode_in_a_browser(tmp_path):
    # A long answer, so the page has to keep the follow-up box clear of the dock.
    ollama = fake_ollama(reply=("Main idea: ", "batteries ", "move ions.") + (" Ions slot between the layers.",) * 30)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(SimulatedBackend(), Tutor(transport=ollama)),
                                           host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        shots = os.environ.get("STUDY_SCREENSHOTS") or str(tmp_path)
        r = subprocess.run([NODE, "tests/study/browser.mjs", f"http://127.0.0.1:{port}", shots], cwd=ROOT,
                           capture_output=True, text=True, timeout=120, env={**os.environ, "NODE_PATH": _node_path()})
        assert r.returncode == 0, r.stdout + r.stderr
        seen = json.loads(r.stdout.strip().splitlines()[-1])
        assert seen["ok"] and seen["cameraAsks"] == 0
    finally:
        server.should_exit = True
        thread.join(timeout=5)
    # The tutor was told how slow the paragraph was against the reader's own pace (companion/tutor.py).
    explain, follow_up = ollama.chats[0], ollama.chats[1]
    system = explain["messages"][0]["content"]
    assert "their usual pace" in system and "2.2×" in system
    assert "When you plug your phone in" in explain["messages"][-1]["content"]
    assert follow_up["messages"][-1]["content"] == "What is graphite?"


def test_extension_uses_the_same_pace_engine():
    # The extension folder is loaded on its own, so it carries a copy; keep the two identical.
    assert (ROOT / "extension/study/study-pace.js").read_text() == (ROOT / "portal/study-pace.js").read_text()


@pytest.mark.skipif(not _has_playwright(), reason="needs Node and Playwright with Chromium")
def test_study_mode_in_the_extension_on_a_news_page():
    import functools
    import http.server

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "tests/study/fixtures"))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/article.html"
        r = subprocess.run([NODE, "tests/study/extension.mjs", url], cwd=ROOT, capture_output=True, text=True,
                           timeout=180, env={**os.environ, "NODE_PATH": _node_path()})
        assert r.returncode == 0, r.stdout + r.stderr
        assert json.loads(r.stdout.strip().splitlines()[-1])["ok"]
    finally:
        httpd.shutdown()


@pytest.mark.skipif(not _has_playwright(), reason="needs Node and Playwright with Chromium")
def test_study_mode_explains_hands_free_in_the_extension():
    # The extension talks to the companion on 127.0.0.1:8765, so the stand-in tutor runs there.
    import functools
    import http.server
    import sys

    sys.path.insert(0, str(ROOT / "tests/study"))
    from standin import StandIn

    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", 8765)) == 0:
            pytest.skip("something is already running on 127.0.0.1:8765")
    standin = StandIn()
    server = uvicorn.Server(uvicorn.Config(create_app(SimulatedBackend(), Tutor(transport=standin)),
                                           host="127.0.0.1", port=8765, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "tests/study/fixtures"))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        deadline = time.time() + 10
        while not server.started and time.time() < deadline:
            time.sleep(0.05)
        url = f"http://127.0.0.1:{httpd.server_address[1]}/article.html"
        r = subprocess.run([NODE, "tests/study/features.mjs", url], cwd=ROOT, capture_output=True, text=True,
                           timeout=240, env={**os.environ, "NODE_PATH": _node_path()})
        assert r.returncode == 0, r.stdout + r.stderr + "\n".join(repr(c["messages"][-1]["content"][:120]) for c in standin.chats)
        assert json.loads(r.stdout.strip().splitlines()[-1])["ok"]
    finally:
        httpd.shutdown()
        server.should_exit = True
        thread.join(timeout=5)
    prompts = [c["messages"][-1]["content"] for c in standin.chats]
    # Look-back reached the tutor, and so did "explain it a different way".
    assert any(p.startswith("Earlier in the same section I also slowed down on:") for p in prompts)
    assert any("still doesn't click" in p and "A battery is a small chemical factory" in p for p in prompts)


def test_look_back_paragraphs_reach_the_tutor():
    from companion.tutor import explain_request

    text = explain_request("Para three.", "T", earlier=["Para one."])
    assert text.startswith('Earlier in the same section I also slowed down on:\n\n(earlier 1) """Para one."""')
    assert text.endswith("Explain the one I'm stuck on now. If one of the earlier ones is the real gap, say so in one sentence first.")
    assert "Earlier" not in explain_request("Para three.", "T")
    ollama = fake_ollama()
    with TestClient(create_app(SimulatedBackend(), Tutor(transport=ollama))) as client, client.websocket_connect("/ws/chat") as ws:
        ws.send_json({"type": "explain", "paragraph": "Para three.", "earlier": ["x" * 2000, 5, "two", "three", "four"]})
        while ws.receive_json()["type"] != "done":
            pass
    sent = ollama.chats[0]["messages"][-1]["content"]
    assert "x" * 600 in sent and "x" * 601 not in sent, "each capped at 600 characters"
    assert '"""two"""' in sent and '"""three"""' in sent and "four" not in sent, "strings only, at most 3"
