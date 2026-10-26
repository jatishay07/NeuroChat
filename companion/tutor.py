"""The tutor: re-explains a paragraph the reader struggled with, using a local model in Ollama.

Each chat (one WebSocket) keeps its own message history so follow-up questions have context.
Replies stream token by token.
"""
from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import httpx

OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
if not OLLAMA_URL.startswith("http"):
    OLLAMA_URL = f"http://{OLLAMA_URL}"
DEFAULT_MODEL = os.environ.get("NEUROCHAT_MODEL", "qwen3.5:4b")

SYSTEM_PROMPT = """You are a patient tutor helping someone who is reading a text.
They just spent much longer than usual on one paragraph, which suggests it confused them.
Explain that paragraph again in plain language:
- start with the one main idea in a single sentence;
- then explain it in at most 120 words, defining any jargon you keep;
- use one everyday analogy if it helps;
- don't repeat the original wording, and don't lecture beyond the paragraph.
End by asking in one short sentence whether that made sense or which part is still unclear.
For follow-up questions, answer briefly and concretely."""

# For chats that don't start from a paragraph (the chat page, and Open WebUI's NeuroChat Tutor).
CHAT_PROMPT = """You are a patient tutor. The person is reading something and wants help understanding it.
Explain in plain language: the main idea first, then the details, defining any jargon you keep.
Use an everyday analogy when it helps, keep answers short, and ask what is still unclear."""


class TutorError(Exception):
    """Ollama isn't reachable or the model isn't available; the message is shown to the user."""


class Tutor:
    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = OLLAMA_URL,
                 transport: httpx.AsyncBaseTransport | None = None):
        self.model = model
        self.base_url = base_url
        self._transport = transport  # tests pass a mock transport

    def _client(self, timeout: float | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=timeout, transport=self._transport)

    async def status(self) -> dict:
        try:
            async with self._client(3.0) as c:
                r = await c.get("/api/tags")
                r.raise_for_status()
        except httpx.HTTPError:
            return {"model": self.model, "ready": False,
                    "error": "Ollama isn't running. Start NeuroChat with the neurochat command to start it."}
        names = {m.get("name") for m in r.json().get("models", [])}
        if self.model not in names and f"{self.model}:latest" not in names:
            return {"model": self.model, "ready": False,
                    "error": f"The model {self.model} isn't downloaded yet. Run neurochat again to download it."}
        return {"model": self.model, "ready": True, "error": None}

    async def stream(self, messages: list[dict], system: str = SYSTEM_PROMPT) -> AsyncIterator[str]:
        """Send the conversation and yield the reply as it arrives."""
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": True,
            "think": False,  # Qwen3.5 can "think" first; for a tutor reply that's just a long wait
            "options": {"temperature": 0.4},
        }
        try:
            async with self._client(None) as c, c.stream("POST", "/api/chat", json=body) as r:
                if r.status_code == 404:
                    raise TutorError(f"The model {self.model} isn't downloaded yet. Run neurochat again to download it.")
                if r.status_code >= 400:
                    detail = (await r.aread()).decode(errors="replace")[:200]
                    raise TutorError(f"Ollama returned an error: {detail}")
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    if chunk.get("error"):
                        raise TutorError(f"Ollama returned an error: {chunk['error']}")
                    text = chunk.get("message", {}).get("content", "")
                    if text:
                        yield text
                    if chunk.get("done"):
                        break
        except httpx.ConnectError as e:
            raise TutorError("Ollama isn't running. Start NeuroChat with the neurochat command to start it.") from e


def explain_request(paragraph: str, title: str | None = None, context: str | None = None) -> str:
    """paragraph is what to explain: a paragraph, or a passage the reader selected. context is the
    paragraph around a selection, so a short selection ("Gibbs free energy") isn't explained blind."""
    where = f' in a text titled "{title}"' if title else ""
    if context and context.strip() != paragraph.strip():
        return (f"I got stuck on this part{where}. Can you explain it differently?\n\n\"\"\"{paragraph}\"\"\"\n\n"
                f"It's from this paragraph:\n\n\"\"\"{context}\"\"\"")
    return f"I got stuck on this paragraph{where}. Can you explain it differently?\n\n\"\"\"{paragraph}\"\"\""
