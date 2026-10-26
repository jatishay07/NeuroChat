"""HTTP and WebSocket API of the companion app, plus the portal it serves.

Everything listens on localhost only. The portal and, later, the browser
extension use the same endpoints.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .device import Backend, BackendError, BrowserHeadset, DeviceManager
from .gaze import GazeSession, visit_json
from .tutor import CHAT_PROMPT, SYSTEM_PROMPT, Tutor, TutorError, explain_request, reader_notes
from .webui import WebUI, WebUIError

PORTAL_DIR = Path(__file__).resolve().parent.parent / "portal"


class ConnectRequest(BaseModel):
    address: str


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

    def signals_for(msg: dict) -> str:
        """The reading page's numbers for this paragraph plus the gaze log's visits and engagement.
        Engagement is passed on only while a real headset streams: the fake one's EEG means nothing."""
        def num(key):
            v = msg.get(key)
            return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None
        index = msg.get("index")
        row, median = None, None
        if isinstance(index, int):
            summary = gaze.summary()
            row = next((r for r in summary["paragraphs"] if r["paragraph"] == index), None)
            median = summary["median_engagement"]
        real_eeg = device.state == "streaming" and not getattr(device.backend, "simulated", False)
        return reader_notes(
            num("dwellMsPer100Words"), num("medianMsPer100Words"),
            int(msg["rereads"]) if isinstance(msg.get("rereads"), int) else None,
            row["visits"] if row else None,
            row["engagement"] if row and real_eeg else None,
            median if real_eeg else None,
        )

    @app.websocket("/ws/chat")
    async def chat(ws: WebSocket):
        """One conversation with the tutor. The client sends
        {"type": "explain", "paragraph": ..., "title": ..., "context": ...} to start on a paragraph
        (or a selected passage, with the paragraph around it as optional context), optionally with what
        the reading page measured: "index", "dwellMsPer100Words", "medianMsPer100Words", "rereads"; or
        {"type": "ask", "text": ...} for a follow-up. Replies stream back as
        {"type": "start"}, then {"type": "token", "text": ...}..., then {"type": "done"},
        or {"type": "error", "message": ...}.
        {"type": "continue"} copies the conversation into Open WebUI and answers
        {"type": "continued", "url": ...} (or an error), so it can carry on there."""
        await ws.accept()
        history: list[dict] = []
        title = "Chat with the tutor"
        system = SYSTEM_PROMPT
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
                if msg.get("type") == "explain" and msg.get("paragraph"):
                    title = f"Explaining: {msg['paragraph'][:60].strip()}…"
                    system = SYSTEM_PROMPT + signals_for(msg)
                    history = [{"role": "user", "content": explain_request(msg["paragraph"][:6000], msg.get("title"), (msg.get("context") or "")[:6000])}]
                elif msg.get("type") == "ask" and msg.get("text", "").strip():
                    if not history:  # a chat that starts with a question, not a paragraph
                        title = msg["text"].strip()[:60]
                        system = CHAT_PROMPT
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

    if PORTAL_DIR.is_dir():
        app.mount("/", StaticFiles(directory=PORTAL_DIR, html=True), name="portal")
    return app
