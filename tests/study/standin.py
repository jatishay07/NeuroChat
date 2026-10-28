"""A stand-in for Ollama that answers each kind of study-mode request the way the real tutor would,
so the extension's features can be tested (tests/study/features.mjs) and filmed
(tests/study/record-features.mjs) without a model. delay > 0 streams it at reading speed."""
import asyncio
import json
import re

import httpx

EXPLAIN = ("In plain words: a battery has two sides, and charging only works if you push hard enough to beat the "
           "voltage the battery already has. Then lithium ions move through the liquid into the graphite side, while "
           "electrons go the long way round through the charger's wire, so the charges stay balanced.\n\n"
           "**Think of it like this:** water only flows uphill into a tank if the pump pushes harder than the water "
           "pushing back. Does that make sense, or is one part still unclear?")
AGAIN = ("Try it this way: picture two buckets joined by a pipe. Charging is pumping water from the low bucket to the "
         "high one. The pump (your charger) has to push harder than the water wants to flow back. The water is the "
         "lithium; the high bucket is the graphite.")
PLAIN = ("A battery only charges when the charger pushes harder than the battery pushes back. When it does, lithium "
         "ions move through the liquid and settle into the graphite, while electrons travel round through the wire, "
         "so the charges on each side stay balanced.")
QUESTION = "What has to be true before lithium ions will move into the graphite while you charge?"
GRADE = "RIGHT. Exactly: the charger has to push harder than the battery's own voltage, or nothing moves."
DEFS = {"electrons": "tiny charged particles; their flow through a wire is electric current.",
        "lithium": "a very light metal whose ions carry the charge inside phone batteries.",
        "graphite": "a form of carbon made of stacked sheets, the same as pencil lead."}


def answer(prompt: str) -> str:
    if "Rewrite the paragraph below in plain language" in prompt:
        return PLAIN
    if "Define each of these terms" in prompt:
        terms = [t.strip() for t in prompt.rsplit("Terms:", 1)[-1].split(",")]
        return "\n".join(f"**{t}**: {DEFS.get(t.lower(), 'a key term in this text.')}" for t in terms)
    if "Ask me one short question" in prompt:
        return QUESTION
    if "Mark my answer" in prompt:
        return GRADE
    if "still doesn't click" in prompt:
        return AGAIN
    return EXPLAIN


class StandIn(httpx.AsyncBaseTransport):
    def __init__(self, delay: float = 0.0):
        self.delay = delay
        self.chats: list[dict] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3.5:4b"}]})
        if request.url.path != "/api/chat":
            return httpx.Response(404)
        body = json.loads(await request.aread())
        self.chats.append(body)
        text = answer(body["messages"][-1]["content"])
        delay = self.delay

        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                for w in re.findall(r"\S+\s*", text):
                    if delay:
                        await asyncio.sleep(delay)
                    yield (json.dumps({"message": {"content": w}, "done": False}) + "\n").encode()
                yield (json.dumps({"message": {"content": ""}, "done": True}) + "\n").encode()

        return httpx.Response(200, stream=Body())


if __name__ == "__main__":  # a companion with the stand-in, for recording: python tests/study/standin.py [delay]
    import sys
    from pathlib import Path

    import uvicorn

    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from companion.app import create_app
    from companion.device import SimulatedBackend
    from companion.tutor import Tutor

    uvicorn.run(create_app(SimulatedBackend(), Tutor(transport=StandIn(float(sys.argv[1]) if len(sys.argv) > 1 else 0.04))),
                host="127.0.0.1", port=8765, log_level="warning")
