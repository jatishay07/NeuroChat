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
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .device import Backend, BackendError, DeviceManager
from .tutor import Tutor, TutorError, explain_request

PORTAL_DIR = Path(__file__).resolve().parent.parent / "portal"


class ConnectRequest(BaseModel):
    address: str


def create_app(backend: Backend, tutor: Tutor | None = None) -> FastAPI:
    device = DeviceManager(backend)
    tutor = tutor or Tutor()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await device.disconnect()   # stop OpenMuse cleanly when the app exits

    app = FastAPI(title="NeuroChat companion", lifespan=lifespan)
    app.state.device = device
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

    @app.get("/api/tutor")
    async def tutor_status():
        return await tutor.status()

    @app.websocket("/ws/chat")
    async def chat(ws: WebSocket):
        """One conversation with the tutor. The client sends
        {"type": "explain", "paragraph": ..., "title": ...} to start on a paragraph, or
        {"type": "ask", "text": ...} for a follow-up. Replies stream back as
        {"type": "start"}, then {"type": "token", "text": ...}..., then {"type": "done"},
        or {"type": "error", "message": ...}."""
        await ws.accept()
        history: list[dict] = []
        try:
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "explain" and msg.get("paragraph"):
                    history = [{"role": "user", "content": explain_request(msg["paragraph"], msg.get("title"))}]
                elif msg.get("type") == "ask" and msg.get("text", "").strip():
                    history.append({"role": "user", "content": msg["text"].strip()})
                else:
                    await ws.send_json({"type": "error", "message": "Unknown message."})
                    continue
                await ws.send_json({"type": "start"})
                reply = []
                try:
                    async for text in tutor.stream(history):
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

    if PORTAL_DIR.is_dir():
        app.mount("/", StaticFiles(directory=PORTAL_DIR, html=True), name="portal")
    return app
