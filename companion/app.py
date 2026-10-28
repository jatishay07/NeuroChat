"""HTTP and WebSocket API of the companion app, plus the portal it serves.

Everything listens on localhost only. The portal and, later, the browser
extension use the same endpoints.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .device import Backend, BackendError, BrowserHeadset, DeviceManager
from .engagement import CalibrationError, LiveEngagement
from .gaze import GazeSession, visit_json
from .session_record import record_router
from .tutor import CHAT_PROMPT, SYSTEM_PROMPT, Tutor, TutorError, explain_request, reader_notes
from .webui import WebUI, WebUIError

PORTAL_DIR = Path(__file__).resolve().parent.parent / "portal"


class ConnectRequest(BaseModel):
    address: str


class CalibrationValues(BaseModel):
    e_min: float
    e_max: float


def create_app(backend: Backend, tutor: Tutor | None = None, webui: WebUI | None = None) -> FastAPI:
    device = DeviceManager(backend)
    tutor = tutor or Tutor()
    webui = webui or WebUI(model=tutor.model)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        setup = asyncio.create_task(webui.prepare())
        yield
        setup.cancel()
        await device.disconnect()   # stop OpenMuse cleanly when the app exits

    app = FastAPI(title="NeuroChat companion", lifespan=lifespan)
    app.state.device = device
    gaze = GazeSession(device.eeg_between, lambda: device.backend.srate)
    app.state.gaze = gaze
    engagement = LiveEngagement(device.eeg_between, device.window, lambda: device.backend.srate, time.monotonic)
    app.state.engagement = engagement

    def meaningful_eeg() -> bool:
        """Real headset EEG, or synthetic EEG with a known engagement level. The plain simulated
        headset's EEG is noise, so its engagement never reaches the model."""
        b = device.backend
        return device.state == "streaming" and (not getattr(b, "simulated", False) or getattr(b, "synthetic_eeg", False))
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/device")
    async def device_status():
        return device.status()

    @app.post("/api/device/scan")
    async def scan(timeout: float = 5.0):
        try:
            await device.scan(timeout=min(max(timeout, 1.0), 15.0))
        except BackendError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return device.status()

    @app.post("/api/device/connect")
    async def connect(req: ConnectRequest):
        try:
            await device.connect(req.address)
        except BackendError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return device.status()

    @app.post("/api/device/disconnect")
    async def disconnect():
        await device.disconnect()
        return device.status()

    @app.websocket("/ws/device")
    async def device_updates(ws: WebSocket):
        await ws.accept()
        q = device.subscribe()
        try:
            while True:
                await ws.send_json(await q.get())
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        finally:
            device.unsubscribe(q)

    @app.websocket("/ws/headset")
    async def browser_headset(ws: WebSocket):
        """A headset the portal connected with Web Bluetooth. The page sends {"type": "hello", "name": ...},
        then {"type": "data", "packets": [[uuid, hex], ...]} batches of raw notifications, and
        {"type": "lost", "message": ...} if Bluetooth drops. Closing the socket disconnects."""
        await ws.accept()
        headset, error = None, None
        try:
            while True:
                msg = await ws.receive_json()
                kind = msg.get("type")
                if kind == "hello" and headset is None:
                    headset = BrowserHeadset()
                    try:
                        await device.connect_browser(headset, str(msg.get("name") or "Muse")[:40])
                    except BackendError as e:
                        headset = None
                        await ws.send_json({"type": "error", "message": str(e)})
                        break
                elif kind == "data" and headset is not None:
                    if headset.closed:  # disconnected from the portal's button or another tab
                        break
                    headset.feed(msg.get("packets") or [])
                elif kind == "lost":
                    error = str(msg.get("message") or "Lost the headset.")[:200]
                    break
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass
        finally:
            if headset is not None:
                await device.detach(headset, error)
            try:
                await ws.close()
            except RuntimeError:
                pass  # already closed

    @app.get("/api/tutor")
    async def tutor_status():
        return await tutor.status()

    @app.get("/api/webui")
    async def webui_status():
        return await webui.status()

    @app.get("/chat")
    async def open_chat():
        """Straight to the chat: NeuroChat's own chat page. Open WebUI stays one click away from it."""
        return RedirectResponse("/chat.html")

    @app.get("/api/engagement")
    async def engagement_status():
        """The NeuroChat engagement score right now (last 15 s), its bucket, and the calibration."""
        st = engagement.status()
        if not meaningful_eeg():
            st["now"] = None
        return st

    @app.post("/api/engagement/calibration/{phase}/{step}")
    async def calibrate(phase: str, step: str):
        """Calibration as in the paper: start, about 2 minutes of relaxing (phase relax) or of the
        word-chain task (phase task), finish. Both done → scores are normalized to them."""
        if phase not in ("relax", "task") or step not in ("start", "finish"):
            raise HTTPException(status_code=404, detail="Use /relax/start, /relax/finish, /task/start or /task/finish.")
        if not meaningful_eeg():
            raise HTTPException(status_code=409, detail="Connect the headset first.")
        try:
            if step == "start":
                engagement.start(phase)
            else:
                engagement.finish(phase)
        except CalibrationError as e:
            raise HTTPException(status_code=409, detail=str(e))
        return engagement.status()

    @app.put("/api/engagement/calibration")
    async def set_calibration(values: CalibrationValues):
        """Use E_min and E_max from an earlier or offline calibration (python -m companion.engagement)."""
        try:
            engagement.set(values.e_min, values.e_max)
        except CalibrationError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return engagement.status()

    @app.delete("/api/engagement/calibration")
    async def clear_calibration():
        engagement.clear()
        return engagement.status()

    def signals_for(msg: dict | None, follow_up: bool = False) -> str:
        """What the system prompt is told about the reader for this turn: the reading page's numbers
        for the paragraph (msg, the explain request), the gaze log's visits, and EEG engagement.
        Engagement is the paragraph's own when gaze tracked it, else the paper's live score over the
        last 15 s; follow-ups always get the live score, as the paper scores every message."""
        msg = msg or {}

        def num(key):
            v = msg.get(key)
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None
        index = msg.get("index")
        row = None
        if isinstance(index, int):
            row = next((r for r in gaze.summary()["paragraphs"] if r["paragraph"] == index), None)
        reading = None
        if meaningful_eeg():
            if row and row["engagement"] is not None and not follow_up:
                reading = engagement.of(row["engagement"], "while they read this paragraph")
            else:
                reading = engagement.now()
        return reader_notes(
            num("dwellMsPer100Words"), num("medianMsPer100Words"),
            int(msg["rereads"]) if isinstance(msg.get("rereads"), int) else None,
            row["visits"] if row else None,
            reading,
        )

    @app.websocket("/ws/chat")
    async def chat(ws: WebSocket):
        """One conversation with the tutor. The client sends
        {"type": "explain", "paragraph": ..., "title": ..., "context": ...} to start on a paragraph
        (or a selected passage, with the paragraph around it as optional context), optionally with what
        the reading page measured: "index", "dwellMsPer100Words", "medianMsPer100Words", "rereads", and
        "earlier" (study mode's look-back: up to 3 earlier paragraphs that also slowed the reader); or
        {"type": "ask", "text": ...} for a follow-up. Replies stream back as
        {"type": "start"}, then {"type": "token", "text": ...}..., then {"type": "done"},
        or {"type": "error", "message": ...}.
        {"type": "continue"} copies the conversation into Open WebUI and answers
        {"type": "continued", "url": ...} (or an error), so it can carry on there.
        The side chat keeps one conversation per page and restores it with
        {"type": "load", "messages": [{"role", "content"}...], "mode": "explain" | "chat"} (answered
        {"type": "loaded"}), and sends {"type": "explain", ..., "append": true} to add a new passage to
        the conversation instead of starting over."""
        await ws.accept()
        history: list[dict] = []
        title = "Chat with the tutor"
        base = SYSTEM_PROMPT
        passage: dict | None = None   # the explain request the conversation is on, for its reading numbers
        try:
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "continue":
                    if not history:
                        await ws.send_json({"type": "continued", "url": webui.new_chat_url()})
                        continue
                    try:
                        url = await webui.import_chat(history, title)
                    except WebUIError as e:
                        await ws.send_json({"type": "error", "message": str(e)})
                        continue
                    await ws.send_json({"type": "continued", "url": url})
                    continue
                if msg.get("type") == "load":
                    history = [{"role": m["role"], "content": str(m["content"])[:12000]}
                               for m in msg.get("messages") or []
                               if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content")][-40:]
                    base = CHAT_PROMPT if msg.get("mode") == "chat" else SYSTEM_PROMPT
                    passage = None
                    title = (msg.get("title") or title)[:80]
                    await ws.send_json({"type": "loaded"})
                    continue
                if msg.get("type") == "explain" and msg.get("paragraph"):
                    if not (msg.get("append") and history):
                        title = f"Explaining: {msg['paragraph'][:60].strip()}…"
                        base = SYSTEM_PROMPT
                        history = []
                    passage = msg   # an appended passage brings its own numbers too
                    system = base + signals_for(passage)
                    # Study mode's look-back: a few earlier paragraphs, kept short for a small model.
                    earlier = [e[:600] for e in msg.get("earlier") or [] if isinstance(e, str) and e.strip()][:3] if isinstance(msg.get("earlier"), list) else []
                    history.append({"role": "user", "content": explain_request(msg["paragraph"][:6000], msg.get("title"), (msg.get("context") or "")[:6000],
                                                         msg.get("rereads") if isinstance(msg.get("rereads"), int) else None, earlier or None)})
                elif msg.get("type") == "ask" and msg.get("text", "").strip():
                    if not history:  # a chat that starts with a question, not a paragraph
                        title = msg["text"].strip()[:60]
                        base = CHAT_PROMPT
                        passage = None
                    system = base + signals_for(passage, follow_up=True)
                    history.append({"role": "user", "content": msg["text"].strip()})
                else:
                    await ws.send_json({"type": "error", "message": "Unknown message."})
                    continue
                await ws.send_json({"type": "start"})
                reply = []
                try:
                    async for text in tutor.stream(history, system):
                        reply.append(text)
                        await ws.send_json({"type": "token", "text": text})
                except TutorError as e:
                    history.pop()
                    await ws.send_json({"type": "error", "message": str(e)})
                    continue
                history.append({"role": "assistant", "content": "".join(reply)})
                await ws.send_json({"type": "done"})
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    @app.websocket("/ws/gaze")
    async def gaze_events(ws: WebSocket):
        """Where the reader's eyes are, from the reading page. The page sends {"type": "enter", "paragraph": i}
        when the gaze settles on a paragraph, {"type": "leave"} when it leaves the text or the face is lost,
        and {"type": "reset"} to start a new reading. Each closed visit comes back as
        {"type": "visit", "paragraph", "seconds", "engagement"}, engagement being the EEG engagement index
        over the visit (null without headset data). A new connection starts a new reading."""
        await ws.accept()
        gaze.reset()
        try:
            while True:
                msg = await ws.receive_json()
                kind = msg.get("type")
                if kind == "enter" and isinstance(msg.get("paragraph"), int) and msg["paragraph"] >= 0:
                    visit = gaze.enter(msg["paragraph"])
                elif kind == "leave":
                    visit = gaze.leave()
                elif kind == "reset":
                    gaze.reset()
                    visit = None
                else:
                    await ws.send_json({"type": "error", "message": "Unknown message."})
                    continue
                if visit is not None:
                    await ws.send_json(visit_json(visit))
        except (WebSocketDisconnect, asyncio.CancelledError):
            gaze.leave()

    @app.get("/api/gaze")
    async def gaze_summary():
        return gaze.summary()

    app.include_router(record_router(device))   # Phase 2 recording page (reading-signals)

    if PORTAL_DIR.is_dir():
        app.mount("/", StaticFiles(directory=PORTAL_DIR, html=True), name="portal")
    return app
