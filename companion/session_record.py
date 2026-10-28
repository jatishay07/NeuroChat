"""Recording mode for Phase 2: one reading session saved to disk, EEG and page
events on one clock.

The recording page (portal/record.html) walks the reader through a short
calibration (eyes closed, a dot that jumps by known angles, blinks and jaw
clenches on cue) and then easy and hard texts shown one paragraph at a time.
Every step, dot position, paragraph shown, line layout, Explain press and
end-of-session rating goes over /ws/record and is stamped here with
time.monotonic(), the clock the headset buffer uses. While recording, the EEG is
copied out of the 180-second buffer every second, so a session can run as long
as it needs.

Each session is a folder under data/sessions/ (never committed: it is biometric data), or under
$NEUROCHAT_DATA/sessions if that is set:
- meta.json:     what the page sent at the start (screen size, viewing distance, texts), plus srate
- eeg.csv:       t (seconds from the start), TP9, AF7, AF8, TP10 in µV
- events.jsonl:  one stamped event per line, t on the same clock as eeg.csv
- summary.json:  written at stop: blinks, saccades and clenches found, and how well the detectors
                 caught the calibration dot jumps (the Phase 1 question, on the reader's own head)
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import csv
from datetime import datetime
import json
import os
from pathlib import Path
import time

from fastapi import APIRouter
from fastapi import HTTPException
from fastapi import WebSocket
from fastapi import WebSocketDisconnect
import numpy as np

from .eyedata import score_saccades
from .eyemove import detect
from .eyemove import fit_gain

PULL_SECONDS = 1.0
MAX_EVENT_BYTES = 64_000  # a paragraph's line layout fits easily; anything bigger is a mistake


def data_root() -> Path:
    env = os.environ.get("NEUROCHAT_DATA")
    base = Path(env) if env else Path(__file__).resolve().parent.parent / "data"
    return base / "sessions"


class RecordError(Exception):
    pass


class SessionRecorder:
    """samples_between(t0, t1) returns (monotonic times, channels × samples)
    that arrived after t0.
    """

    def __init__(
        self,
        samples_between: Callable[
            [float, float], tuple[np.ndarray, np.ndarray]
        ],
        channels: Callable[[], list[str]],
        srate: Callable[[], float],
        root: Callable[[], Path] = data_root,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._samples_between = samples_between
        self._channels = channels
        self._srate = srate
        self._root = root
        self._clock = clock
        self.path: Path | None = None
        self.t0 = 0.0
        self._cursor = 0.0
        self._eeg_file = None
        self._eeg = None
        self._events = None
        self.samples = 0
        self.events = 0

    @property
    def active(self) -> bool:
        return self.path is not None

    def status(self) -> dict:
        return {
            "active": self.active,
            "id": self.path.name if self.path else None,
            "seconds": round(self._clock() - self.t0, 1) if self.active else 0,
            "samples": self.samples,
            "events": self.events,
        }

    def start(self, meta: dict) -> dict:
        if self.active:
            raise RecordError("A recording is already running. Stop it first.")
        root = self._root()
        root.mkdir(parents=True, exist_ok=True)
        name = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = root / name
        n = 1
        while path.exists():
            n += 1
            path = root / f"{name}-{n}"
        path.mkdir()
        self.t0 = self._cursor = self._clock()
        channels = list(self._channels())
        (path / "meta.json").write_text(
            json.dumps(
                {
                    **meta,
                    "channels": channels,
                    "srate": self._srate(),
                    "started": datetime.now().isoformat(timespec="seconds"),
                },
                indent=2,
            )
        )
        self._eeg_file = (path / "eeg.csv").open("w", newline="")
        self._eeg = csv.writer(self._eeg_file)
        self._eeg.writerow(["t", *channels])
        self._events = (path / "events.jsonl").open("w")
        self.samples = self.events = 0
        self.path = path
        return self.status()

    def pull(self) -> int:
        """Copy EEG that arrived since the last pull into eeg.csv."""
        if not self.active:
            return 0
        now = self._clock()
        times, eeg = self._samples_between(self._cursor, now)
        self._cursor = now
        if len(times):
            rows = np.column_stack(
                [np.asarray(times) - self.t0, np.asarray(eeg).T]
            )
            self._eeg.writerows(
                [f"{r[0]:.4f}", *(f"{v:.2f}" for v in r[1:])] for r in rows
            )
            self._eeg_file.flush()
            self.samples += len(times)
        return len(times)

    def event(self, msg: dict) -> dict:
        if not self.active:
            raise RecordError("Not recording.")
        if not isinstance(msg.get("type"), str):
            raise RecordError("An event needs a type.")
        line = json.dumps({**msg, "t": round(self._clock() - self.t0, 4)})
        if len(line) > MAX_EVENT_BYTES:
            raise RecordError("Event too large.")
        self._events.write(line + "\n")
        self._events.flush()
        self.events += 1
        return json.loads(line)

    def stop(self) -> dict:
        if not self.active:
            raise RecordError("Not recording.")
        self.pull()
        self._eeg_file.close()
        self._events.close()
        path, self.path = self.path, None
        summary = summarize(path)
        (path / "summary.json").write_text(json.dumps(summary, indent=2))
        return summary


def load_session(
    path: str | Path,
) -> tuple[np.ndarray, np.ndarray, float, list[dict], dict]:
    """(t, eeg channels × samples, srate, events, meta) for a saved session."""
    path = Path(path)
    meta = json.loads((path / "meta.json").read_text())
    with (path / "eeg.csv").open(newline="") as f:
        reader = csv.reader(f)
        next(reader)
        rows = np.array([[float(v) for v in r] for r in reader if r]).reshape(
            -1, 1 + len(meta["channels"])
        )
    events = [
        json.loads(line)
        for line in (path / "events.jsonl").read_text().splitlines()
        if line.strip()
    ]
    t = rows[:, 0]
    srate = (
        (len(t) - 1) / (t[-1] - t[0])
        if len(t) > 1 and t[-1] > t[0]
        else float(meta.get("srate") or 256.0)
    )
    return t, rows[:, 1:].T, float(srate), events, meta


def dot_jumps(events: list[dict]) -> list[tuple[float, float]]:
    """(time, signed horizontal degrees) for each calibration dot move."""
    out, last = [], None
    for e in events:
        if e.get("type") == "dot" and isinstance(e.get("x_deg"), (int, float)):
            if last is not None and e["x_deg"] != last:
                out.append((float(e["t"]), float(e["x_deg"] - last)))
            last = e["x_deg"]
    return out


def summarize(path: str | Path) -> dict:
    t, eeg, srate, events, meta = load_session(path)
    seconds = float(t[-1] - t[0]) if len(t) > 1 else 0.0
    out: dict = {
        "id": Path(path).name,
        "seconds": round(seconds, 1),
        "samples": int(len(t)),
        "events": len(events),
    }
    if len(t) < srate * 5:
        out["note"] = "Less than 5 seconds of EEG: was the headset streaming?"
        return out
    ev = detect(eeg, srate)
    out.update(
        blinks=len(ev.blinks),
        saccades=len(ev.saccades),
        clenches=len(ev.clenches),
    )
    jumps = [(tj - t[0], d) for tj, d in dot_jumps(events)]
    if jumps:
        score = score_saccades(ev.saccades, jumps, seconds)
        out["dot_jumps"] = score.by_size()
        hits = [m for m in score.matches if m.saccade is not None]
        if len(hits) >= 3:
            out["gain_uv_per_degree"] = round(
                fit_gain(
                    [m.saccade.step_uv for m in hits],
                    [m.jump_deg for m in hits],
                ),
                2,
            )
    cues = {
        k: [
            e["t"] - t[0]
            for e in events
            if e.get("type") == "cue" and e.get("what") == k
        ]
        for k in ("blink", "clench")
    }
    if cues["blink"]:
        out["blink_cues_caught"] = sum(
            any(0 <= b.t - c <= 2.0 for b in ev.blinks) for c in cues["blink"]
        )
        out["blink_cues"] = len(cues["blink"])
    if cues["clench"]:
        out["clench_cues_caught"] = sum(
            any(-0.5 <= k.start - c <= 2.5 for k in ev.clenches)
            for c in cues["clench"]
        )
        out["clench_cues"] = len(cues["clench"])
    return out


def record_router(device) -> APIRouter:
    """Routes for the recording page. device is the DeviceManager."""
    router = APIRouter()
    rec = SessionRecorder(
        device.samples_between,
        lambda: device.backend.channels,
        lambda: device.backend.srate,
    )
    pump: dict[str, asyncio.Task | None] = {"task": None}

    async def pull_forever():
        while rec.active:
            rec.pull()
            await asyncio.sleep(PULL_SECONDS)

    @router.get("/api/record")
    async def record_status():
        return {**rec.status(), "headset": device.state}

    @router.post("/api/record/start")
    async def record_start(meta: dict):
        try:
            status = rec.start(meta)
        except RecordError as e:
            raise HTTPException(409, str(e)) from e
        pump["task"] = asyncio.create_task(pull_forever())
        return {**status, "headset": device.state}

    @router.post("/api/record/stop")
    async def record_stop():
        try:
            summary = await asyncio.to_thread(rec.stop)
        except RecordError as e:
            raise HTTPException(409, str(e)) from e
        if pump["task"]:
            pump["task"].cancel()
        return summary

    @router.websocket("/ws/record")
    async def record_events(ws: WebSocket):
        """Page events while recording: any JSON object with a string "type".

        Each is stamped and saved,
        and answered with {"type": "ok", "t"} or {"type": "error", "message"}.
        """
        await ws.accept()
        try:
            while True:
                msg = await ws.receive_json()
                try:
                    saved = rec.event(msg if isinstance(msg, dict) else {})
                    await ws.send_json({"type": "ok", "t": saved["t"]})
                except RecordError as e:
                    await ws.send_json({"type": "error", "message": str(e)})
        except (WebSocketDisconnect, asyncio.CancelledError):
            pass

    router.recorder = rec
    return router
