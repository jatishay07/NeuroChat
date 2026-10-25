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

PORTAL_DIR = Path(__file__).resolve().parent.parent / "portal"


class ConnectRequest(BaseModel):
    address: str


def create_app(backend: Backend) -> FastAPI:
    device = DeviceManager(backend)

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

    if PORTAL_DIR.is_dir():
        app.mount("/", StaticFiles(directory=PORTAL_DIR, html=True), name="portal")
    return app
