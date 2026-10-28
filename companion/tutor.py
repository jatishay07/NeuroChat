"""The tutor: re-explains a paragraph the reader struggled with, using a local model in Ollama.

Any model works. NEUROCHAT_MODEL picks the model (default qwen3.5:4b). By default it runs in Ollama;
set NEUROCHAT_LLM_URL to any OpenAI-compatible endpoint (LM Studio, llama.cpp's server, vLLM, OpenAI,
OpenRouter...) to use that instead, with NEUROCHAT_LLM_API_KEY if it needs a key.

Each chat (one WebSocket) keeps its own message history so follow-up questions have context.
Replies stream token by token.
"""
from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import httpx

from .engagement import Reading, engagement_notes

OLLAMA_URL = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
if not OLLAMA_URL.startswith("http"):
    OLLAMA_URL = f"http://{OLLAMA_URL}"
DEFAULT_MODEL = os.environ.get("NEUROCHAT_MODEL") or "qwen3.5:4b"
# An OpenAI-compatible endpoint, e.g. http://127.0.0.1:1234/v1. Empty means Ollama.
LLM_URL = os.environ.get("NEUROCHAT_LLM_URL", "").rstrip("/")
LLM_API_KEY = os.environ.get("NEUROCHAT_LLM_API_KEY", "")

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
    """Talks to Ollama, or to an OpenAI-compatible server when openai_url is given."""

    def __init__(self, model: str = DEFAULT_MODEL, base_url: str = OLLAMA_URL,
                 transport: httpx.AsyncBaseTransport | None = None,
                 openai_url: str | None = LLM_URL or None, api_key: str = LLM_API_KEY):
        self.model = model
        self.openai = bool(openai_url)
        self.base_url = openai_url if self.openai else base_url
        self._headers = {"Authorization": f"Bearer {api_key}"} if self.openai and api_key else {}
        self._transport = transport  # tests pass a mock transport

    def _client(self, timeout: float | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=timeout, transport=self._transport,
                                 headers=self._headers)

    async def status(self) -> dict:
        if self.openai:
            return await self._openai_status()
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
        if self.openai:
            async for text in self._openai_stream(messages, system):
                yield text
            return
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

    async def _openai_status(self) -> dict:
        unreachable = f"Can't reach the model server at {self.base_url} (NEUROCHAT_LLM_URL)."
        try:
            async with self._client(5.0) as c:
                r = await c.get("/models")
        except httpx.HTTPError:
            return {"model": self.model, "ready": False, "error": unreachable}
        if r.status_code in (401, 403):
            return {"model": self.model, "ready": False,
                    "error": f"The model server at {self.base_url} refused the API key (NEUROCHAT_LLM_API_KEY)."}
        if r.status_code >= 400:
            return {"model": self.model, "ready": False, "error": unreachable}
        ids = {m.get("id") for m in (r.json().get("data") or [])}
        if ids and self.model not in ids:
            return {"model": self.model, "ready": False,
                    "error": f"The model server at {self.base_url} has no model called {self.model} (NEUROCHAT_MODEL)."}
        return {"model": self.model, "ready": True, "error": None}

    async def _openai_stream(self, messages: list[dict], system: str) -> AsyncIterator[str]:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, *messages],
            "stream": True,
            "temperature": 0.4,
        }
        try:
            async with self._client(None) as c, c.stream("POST", "/chat/completions", json=body) as r:
                if r.status_code >= 400:
                    detail = (await r.aread()).decode(errors="replace")[:200]
                    raise TutorError(f"The model server returned an error: {detail}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    if chunk.get("error"):
                        raise TutorError(f"The model server returned an error: {chunk['error']}")
                    for choice in chunk.get("choices") or []:
                        text = (choice.get("delta") or {}).get("content")
                        if text:
                            yield text
        except httpx.ConnectError as e:
            raise TutorError(f"Can't reach the model server at {self.base_url} (NEUROCHAT_LLM_URL).") from e


def reader_notes(dwell_ms_per_100_words: float | None = None, median_ms_per_100_words: float | None = None,
                 rereads: int | None = None, visits: int | None = None,
                 engagement: Reading | None = None) -> str:
    """What the eye tracker and the headset saw, written for the system prompt, with what each
    signal means for how to explain. Anything not measured is left out, so the model never sees
    made-up numbers. engagement is the NeuroChat kernel's reading (see engagement.py), whose
    bucket brings its own instructions."""
    seen, advice = [], []
    ratio = None
    if dwell_ms_per_100_words:
        line = f"- Reading time: {dwell_ms_per_100_words / 1000:.0f} s per 100 words"
        if median_ms_per_100_words:
            ratio = dwell_ms_per_100_words / median_ms_per_100_words
            line += f", {ratio:.1f}× their usual pace"
        seen.append(line + ".")
    went_back = max(rereads or 0, (visits or 1) - 1)
    if went_back:
        seen.append(f"- They went back to this paragraph {went_back} time{'s' if went_back > 1 else ''}.")
        if went_back >= 2:
            advice.append("They kept rereading, so one specific sentence or term is probably the blocker: "
                          "name the part most likely to trip someone up and explain that first.")
    if engagement is not None:
        line, guidance = engagement_notes(engagement)
        seen.append(line)
        if ratio is not None and ratio >= 1.5 and engagement.bucket.name == "low":
            advice.append("They slowed down while their attention dropped, so the paragraph lost them rather than "
                          "challenged them: lead with a concrete example.")
        elif ratio is not None and ratio >= 1.5:
            advice.append("They stayed engaged yet slowed down, so the content itself is hard: "
                          "go step by step and define every technical term before using it.")
        advice += guidance
    if not seen:
        return ""
    notes = "\n\nWhat the eye tracker and headset measured:\n" + "\n".join(seen)
    if advice:
        notes += "\nAdapt your explanation to this:\n" + "\n".join(f"- {a}" for a in advice)
    return notes + ("\nThese measurements are hidden from them. Never mention or hint at them: no EEG, headset, "
                     "engagement, attention, focus or scores, not even as \"given your engagement\", unless they ask.")


def explain_request(paragraph: str, title: str | None = None, context: str | None = None,
                    rereads: int | None = None) -> str:
    """paragraph is what to explain: a paragraph, or a passage the reader selected. context is the
    paragraph around a selection, so a short selection ("Gibbs free energy") isn't explained blind.
    rereads is how often eye tracking saw the reader go back to it."""
    where = f' in a text titled "{title}"' if title else ""
    if rereads and rereads > 0:
        where += f" (I went back and reread it {rereads} time{'s' if rereads > 1 else ''})"
    if context and context.strip() != paragraph.strip():
        return (f"I got stuck on this part{where}. Can you explain it differently?\n\n\"\"\"{paragraph}\"\"\"\n\n"
                f"It's from this paragraph:\n\n\"\"\"{context}\"\"\"")
    return f"I got stuck on this paragraph{where}. Can you explain it differently?\n\n\"\"\"{paragraph}\"\"\""
