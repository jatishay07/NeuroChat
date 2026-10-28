"""Open WebUI: the full chat portal, for carrying on a conversation after the
tutor's first answer.

`neurochat` starts Open WebUI on http://127.0.0.1:3000 with sign-in turned off
(it's a single-person, local install). The companion signs in as that local
user, keeps a "NeuroChat Tutor" model in Open WebUI (Qwen3.5 in Ollama plus the
tutor's instructions), and copies conversations across.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid

import httpx

from .tutor import CHAT_PROMPT
from .tutor import DEFAULT_MODEL

WEBUI_URL = os.environ.get(
    "NEUROCHAT_WEBUI_URL", "http://127.0.0.1:3000"
).rstrip("/")
# Where the browser opens it. Differs from WEBUI_URL only in Docker, where the
# companion reaches Open WebUI by its service name but the browser still uses
# localhost.
PUBLIC_URL = os.environ.get("NEUROCHAT_WEBUI_PUBLIC_URL", WEBUI_URL).rstrip("/")
TUTOR_ID = "neurochat-tutor"


class WebUIError(Exception):
    """Open WebUI isn't running or refused a request; the message is shown to
    the user.
    """


NOT_RUNNING = "Open WebUI isn't running. Start NeuroChat with the neurochat command to start it."


class WebUI:
    def __init__(
        self,
        base_url: str = WEBUI_URL,
        model: str = DEFAULT_MODEL,
        transport: httpx.AsyncBaseTransport | None = None,
        public_url: str | None = None,
    ):
        self.base_url = base_url
        self.public_url = public_url or (
            PUBLIC_URL if base_url == WEBUI_URL else base_url
        )
        self.model = model
        self._transport = transport  # tests pass a mock transport
        self._token: str | None = None
        self._model_ready = False

    def _client(self, timeout: float = 10.0) -> httpx.AsyncClient:
        headers = (
            {"Authorization": f"Bearer {self._token}"} if self._token else {}
        )
        return httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            transport=self._transport,
            headers=headers,
        )

    async def status(self) -> dict:
        try:
            async with self._client(3.0) as c:
                (await c.get("/health")).raise_for_status()
        except httpx.HTTPError:
            return {
                "url": self.public_url,
                "ready": False,
                "error": NOT_RUNNING,
            }
        return {"url": self.public_url, "ready": True, "error": None}

    async def _request(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            if not self._token:
                await self._sign_in()
            async with self._client() as c:
                r = await c.request(method, path, **kw)
                if (
                    r.status_code == 401
                ):  # token expired or the data was reset: sign in again once
                    await self._sign_in()
                    async with self._client() as c2:
                        r = await c2.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise WebUIError(NOT_RUNNING) from e
        return r

    async def _sign_in(self) -> None:
        # With WEBUI_AUTH=False, Open WebUI signs any request in as its single
        # local admin.
        self._token = None
        async with self._client() as c:
            r = await c.post(
                "/api/v1/auths/signin", json={"email": "", "password": ""}
            )
        if r.status_code >= 400:
            raise WebUIError(
                "Open WebUI asked for a sign-in. NeuroChat's copy runs without one; "
                "if you use your own Open WebUI, set NEUROCHAT_WEBUI_URL to NeuroChat's instead."
            )
        self._token = r.json()["token"]

    async def _upsert_model(self, form: dict) -> None:
        r = await self._request(
            "GET", "/api/v1/models/model", params={"id": form["id"]}
        )
        if r.status_code == 200 and r.json():
            r = await self._request(
                "POST",
                "/api/v1/models/model/update",
                params={"id": form["id"]},
                json=form,
            )
        else:
            r = await self._request("POST", "/api/v1/models/create", json=form)
        if r.status_code >= 400:
            raise WebUIError(
                f"Open WebUI couldn't set up the model {form['id']}: {r.text[:200]}"
            )

    async def ensure_tutor(self) -> None:
        """Create or refresh the "NeuroChat Tutor" model in Open WebUI, and tune
        the plain model too.
        """
        if self._model_ready:
            return
        # A small local model needs short prompts. By default Open WebUI
        # attaches ~40 built-in tool definitions (calendar, memory, notes...) to
        # every request and Qwen thinks before answering; on a 4B model that's a
        # long wait with an empty reply. Turn both off.
        fast = {"capabilities": {"builtin_tools": False}}
        await self._upsert_model(
            {
                "id": TUTOR_ID,
                "base_model_id": self.model,
                "name": "NeuroChat Tutor",
                "meta": {
                    "description": f"{self.model} on this computer, as a patient tutor.",
                    "profile_image_url": "/static/favicon.png",
                    **fast,
                },
                "params": {
                    "system": CHAT_PROMPT,
                    "temperature": 0.4,
                    "think": False,
                },
                "is_active": True,
            }
        )
        # Same settings for the plain model when it's picked from the model list
        # (an entry with the Ollama model's own id overrides its defaults in
        # Open WebUI).
        await self._upsert_model(
            {
                "id": self.model,
                "base_model_id": None,
                "name": self.model,
                "meta": {"profile_image_url": "/static/favicon.png", **fast},
                "params": {"think": False},
                "is_active": True,
            }
        )
        # Skip the "What's new" release notes that otherwise cover the first
        # chat after each update.
        r = await self._request("GET", "/api/v1/users/user/settings")
        settings = (r.json() if r.status_code == 200 else None) or {}
        if settings.get("ui", {}).get("showChangelog") is not False:
            settings.setdefault("ui", {})["showChangelog"] = False
            await self._request(
                "POST", "/api/v1/users/user/settings/update", json=settings
            )
        self._model_ready = True

    async def prepare(self, wait: float = 300.0, every: float = 5.0) -> None:
        """At startup: wait for Open WebUI (it starts slower than the companion)
        and set up the models, so they're fast even when someone opens Open
        WebUI directly.
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + wait
        while loop.time() < deadline:
            if (await self.status())["ready"]:
                try:
                    await self.ensure_tutor()
                except WebUIError:
                    pass
                return
            await asyncio.sleep(every)

    def new_chat_url(self) -> str:
        return f"{self.public_url}/?models={TUTOR_ID}"

    async def import_chat(self, messages: list[dict], title: str) -> str:
        """Copy a conversation into Open WebUI and return the link that opens it
        there.
        """
        await self.ensure_tutor()
        r = await self._request(
            "POST",
            "/api/v1/chats/new",
            json={"chat": build_chat(messages, title)},
        )
        if r.status_code >= 400:
            raise WebUIError(
                f"Open WebUI couldn't save the chat: {r.text[:200]}"
            )
        return f"{self.public_url}/c/{r.json()['id']}"


def build_chat(messages: list[dict], title: str, model: str = TUTOR_ID) -> dict:
    """Open WebUI's chat format: a flat message list plus a tree of the same
    messages (it stores edits and regenerations as branches), with the last
    message as the current one.
    """
    now = int(time.time())
    flat, tree, parent = [], {}, None
    for m in messages:
        mid = str(uuid.uuid4())
        msg = {
            "id": mid,
            "parentId": parent,
            "childrenIds": [],
            "role": m["role"],
            "content": m["content"],
            "timestamp": now,
        }
        if m["role"] == "user":
            msg["models"] = [model]
        else:
            msg.update(model=model, modelName="NeuroChat Tutor", done=True)
        if parent:
            tree[parent]["childrenIds"].append(mid)
        tree[mid] = msg
        flat.append(msg)
        parent = mid
    return {
        "title": title,
        "models": [model],
        "params": {},
        "messages": flat,
        "history": {"messages": tree, "currentId": parent},
        "tags": [],
        "timestamp": now * 1000,
    }
