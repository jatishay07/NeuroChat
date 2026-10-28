"""End-to-end check of engagement → prompt, through the real servers and
sockets.

    python -m companion.e2e                      # with a stand-in for Ollama (about a minute)
    python -m companion.e2e --ollama http://127.0.0.1:11434   # with the real model

It starts the companion on a spare port with a simulated headset streaming
synthetic EEG whose engagement follows a script, then does what a reader would:
calibrates (relax, then the word chain), reads three paragraphs while gaze
events say where the eyes are, asks the tutor about each, appends one, and asks
a follow-up. Every request that reaches the model is checked for the engagement
band the script put there, and printed with the reply.
"""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler
from http.server import ThreadingHTTPServer
import json
import re
import socket
import sys
import threading
import time

import httpx
import numpy as np
import uvicorn
from websockets.sync.client import connect as ws_connect

from .app import create_app
from .device import SimulatedBackend
from .engagement import bucket_for
from .tutor import Tutor

# Seconds since the headset connected → the engagement level the synthetic EEG
# carries.
SCRIPT = [
    (0, 13, 0.0, "relax"),
    (13, 26, 0.9, "task"),
    (26, 36, 0.05, "paragraph 0"),
    (36, 46, 1.0, "paragraph 1"),
    (46, 66, 0.45, "paragraph 2"),
]
PARAGRAPHS = [
    (
        "Lithium ions move from the anode to the cathode through the electrolyte while electrons flow "
        "through the external circuit, and the potential difference arises from the disparity in Gibbs free energy.",
        "low",
    ),
    (
        "During charging, intercalation forces lithium ions back between the graphite layers of the anode, "
        "a process limited by solid-state diffusion and the formation of the solid electrolyte interphase.",
        "high",
    ),
    (
        "Overpotential is the extra voltage beyond the thermodynamic value needed to drive the reaction "
        "at a useful rate, and it grows with current density.",
        "moderate",
    ),
]


def level(t: np.ndarray) -> np.ndarray:
    out = np.full(np.shape(t), SCRIPT[-1][2], dtype=float)
    for start, end, lv, _ in SCRIPT:
        out[(t >= start) & (t < end)] = lv
    return out


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeOllama:
    """Enough of Ollama's API for the tutor: /api/tags and a streamed /api/chat."""

    def __init__(self, model: str):

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                body = json.dumps({"models": [{"name": model}]}).encode()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                req = json.loads(
                    self.rfile.read(int(self.headers["Content-Length"]))
                )
                band = next(
                    (
                        b
                        for b in ("LOW", "MODERATE", "HIGH")
                        if f"{b} band" in req["messages"][0]["content"]
                    ),
                    "no",
                )
                self.send_response(200)
                self.end_headers()
                for word in f"(stand-in reply, told the {band} band)".split(
                    " "
                ):
                    self.wfile.write(
                        (
                            json.dumps(
                                {
                                    "message": {"content": word + " "},
                                    "done": False,
                                }
                            )
                            + "\n"
                        ).encode()
                    )
                self.wfile.write(
                    (
                        json.dumps({"message": {"content": ""}, "done": True})
                        + "\n"
                    ).encode()
                )

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


class RecordingTutor(Tutor):
    """The real tutor, keeping each system prompt it sends so the check works
    with real Ollama too.
    """

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.systems: list[str] = []

    async def stream(self, messages, system=None):
        self.systems.append(system)
        async for text in super().stream(messages, system):
            yield text


def run(
    ollama_url: str | None, model: str, log=print, seed: int = 11
) -> list[dict]:
    """Runs the scenario; returns one row per tutor turn.

    Raises AssertionError on a wrong prompt.
    """
    fake = None if ollama_url else FakeOllama(model)
    backend = SimulatedBackend(engagement=level, seed=seed)
    tutor = RecordingTutor(model=model, base_url=ollama_url or fake.url)
    app = create_app(backend, tutor)
    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )
    threading.Thread(target=server.run, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    http = httpx.Client(base_url=base, timeout=30)
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(0.1)
        status = http.get("/api/tutor").json()
        assert status["ready"], f"The tutor isn't ready: {status['error']}"
        http.post("/api/device/scan", params={"timeout": 1})
        http.post("/api/device/connect", json={"address": "SIM-0001"})
        t0 = time.monotonic()
        while http.get("/api/device").json()["state"] != "streaming":
            time.sleep(0.05)

        def at(
            seconds,
        ):  # wait until this many seconds of the script have streamed
            time.sleep(max(0.0, t0 + seconds - time.monotonic()))

        log(
            "Calibrating: relax 1.5–12.5 s, word chain 14.5–25.5 s of synthetic EEG"
        )
        for phase, start, end in (("relax", 1.5, 12.5), ("task", 14.5, 25.5)):
            at(start)
            http.post(
                f"/api/engagement/calibration/{phase}/start"
            ).raise_for_status()
            at(end)
            r = http.post(f"/api/engagement/calibration/{phase}/finish")
            assert r.status_code == 200, r.text
        cal = r.json()
        assert cal["calibrated"], cal
        log(
            f"  E_min {cal['bounds']['relax']:.3f}, E_max {cal['bounds']['task']:.3f}"
        )

        log(
            "Reading: gaze on paragraph 0 at 27.5–35.5 s, 1 at 37.5–45.5 s, 2 at 47.5–55.5 s"
        )
        with ws_connect(f"ws://127.0.0.1:{port}/ws/gaze") as gaze:
            for i, start in enumerate((27.5, 37.5, 47.5)):
                at(start)
                gaze.send(json.dumps({"type": "enter", "paragraph": i}))
                at(start + 8)
                gaze.send(json.dumps({"type": "leave"}))
                gaze.recv(timeout=5)
        summary = http.get("/api/gaze").json()
        assert [p["paragraph"] for p in summary["paragraphs"]] == [0, 1, 2], (
            summary
        )

        turns = [
            (
                "explain paragraph 0",
                {
                    "type": "explain",
                    "paragraph": PARAGRAPHS[0][0],
                    "index": 0,
                    "title": "Batteries",
                    "dwellMsPer100Words": 40000,
                    "medianMsPer100Words": 20000,
                },
                "LOW",
                "while they read this paragraph",
            ),
            (
                "append paragraph 1",
                {
                    "type": "explain",
                    "paragraph": PARAGRAPHS[1][0],
                    "index": 1,
                    "append": True,
                },
                "HIGH",
                "while they read this paragraph",
            ),
            # Usually MODERATE, but a 0.3-wide band can't hold 8 s of noisy EEG
            # every time, so this one is only checked to fall between the other
            # two.
            (
                "new chat on paragraph 2",
                {"type": "explain", "paragraph": PARAGRAPHS[2][0], "index": 2},
                None,
                "while they read this paragraph",
            ),
            (
                "follow-up question",
                {"type": "ask", "text": "Why does it grow with current?"},
                None,
                "over the last 15 seconds",
            ),
        ]
        rows = []
        with ws_connect(
            f"ws://127.0.0.1:{port}/ws/chat", open_timeout=10
        ) as chat:
            for name, msg, band, where in turns:
                sent_at = len(tutor.systems)
                chat.send(json.dumps(msg))
                reply = []
                while True:
                    e = json.loads(chat.recv(timeout=600))
                    if e["type"] == "token":
                        reply.append(e["text"])
                    if e["type"] in ("done", "error"):
                        break
                assert e["type"] == "done", e
                text = "".join(reply).strip()
                rows.append({"turn": name, "expected": band, "reply": text})
                system = tutor.systems[sent_at]
                measured = system[system.index("What the eye tracker") :]
                rows[-1]["prompt"] = measured
                assert f"EEG engagement {where}" in measured, measured
                told = [
                    b
                    for b in ("LOW", "MODERATE", "HIGH")
                    if f"{b} band" in measured
                ]
                score = float(
                    re.search(
                        r"EEG engagement [^:]*: ([0-9.]+) on", measured
                    ).group(1)
                )
                rows[-1]["score"] = score
                assert told == [bucket_for(score).name.upper()], (
                    f"{name}: band doesn't match score\n{measured}"
                )
                assert band is None or told == [band], (
                    f"{name}: expected {band}\n{measured}"
                )
                assert text, f"Empty reply for {name}"
                leaked = [
                    w
                    for w in ("EEG", "headset", "engagement", "engaged")
                    if w.lower() in text.lower()
                ]
                assert not leaked, (
                    f"{name}: the reply mentions {leaked}, which the reader must not see:\n{text}"
                )
                log(
                    f"\n── {name}: the model was told\n{measured}\n── reply ({len(text.split())} words):\n{text}"
                )
        low, high, mid = (r["score"] for r in rows[:3])
        assert low < mid < high, (
            f"Scores out of order: drifting {low}, steady {mid}, gripping {high}"
        )
        now = http.get("/api/engagement").json()["now"]
        assert now and now["bucket"] in ("low", "moderate", "high"), now
        return rows
    finally:
        http.close()
        server.should_exit = True
        if fake:
            fake.server.shutdown()


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(
        prog="python -m companion.e2e",
        description="End-to-end engagement → prompt check.",
    )
    p.add_argument(
        "--ollama",
        help="a real Ollama, e.g. http://127.0.0.1:11434 (default: a stand-in)",
    )
    p.add_argument("--model", default=Tutor().model)
    p.add_argument(
        "--seed", type=int, default=11, help="seed for the synthetic EEG"
    )
    args = p.parse_args(argv)
    try:
        run(args.ollama, args.model, seed=args.seed)
    except AssertionError as e:
        print(f"\nFAILED: {e}", file=sys.stderr)
        sys.exit(1)
    print(
        "\nPASSED: every turn reached the model with the engagement band the EEG carried."
    )


if __name__ == "__main__":
    main()
