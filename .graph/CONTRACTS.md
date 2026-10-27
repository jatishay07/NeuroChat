# CONTRACTS

Shared interfaces between threads. Changing one needs a DECISIONS.md entry and a message to every
thread in its "Used by" column. Source of truth is the code; this file says who depends on what.

## WebSocket (companion, 127.0.0.1:8765)

### /ws/chat — owner: side-chat · used by: portal tutor.js, portal chat.html, extension, portal/study.js (study mode; sends `index`, `title`, `dwellMsPer100Words`, `medianMsPer100Words`, `rereads`; `load` to resume a paragraph's conversation)
Client → server:
- `{"type":"explain","paragraph","title"?,"context"?,"index"?,"dwellMsPer100Words"?,"medianMsPer100Words"?,"rereads"?,"append"?}`
- `{"type":"ask","text"}`
- `{"type":"continue"}` (copy into Open WebUI)
- `{"type":"load","messages":[{"role","content"}],"mode":"explain"|"chat","title"?}`
Server → client: `{"type":"start"}`, `{"type":"token","text"}`…, `{"type":"done"}`,
`{"type":"error","message"}`, `{"type":"loaded"}`, `{"type":"continued","url"}`.

### /ws/gaze — owner: eye-tracking · used by: portal eyes.js
Client → server: `{"type":"enter","paragraph":int}`, `{"type":"leave"}`, `{"type":"reset"}`.
Server → client: `{"type":"visit","paragraph","seconds","engagement"}` (engagement null without EEG),
`{"type":"error","message"}`. A new connection starts a new reading. `GET /api/gaze` = summary.

### /ws/headset — owner: graph (interim, from build) · used by: portal bluetooth.js
Client → server: `{"type":"hello","name"}`, then `{"type":"data","packets":[[uuid,hex],...]}`,
`{"type":"lost","message"}`. Server → client: `{"type":"error","message"}`. Close = disconnect.
Muse BLE: service 0xfe8d, chars 273e0001/0013/0014, init `v6 s h p1041 s dc001 dc001 L1 s`.

### /ws/device — owner: graph (interim) · used by: portal app.js (connect screen, live waveforms)
Server → client, on every change: `{"state","error","devices":[...],"device","channels","quality",
"srate","simulated","wave"}`; `wave` = 4 channels × 60 points (2 s at 4 Hz) while streaming, else null.
HTTP: `GET /api/device`, `POST /api/device/scan?timeout=`, `POST /api/device/connect {address}`,
`POST /api/device/disconnect`.

## HTTP

- Engagement — owner: engagement · used by: tutor, (planned) calibration screen:
  `GET /api/engagement`; `POST /api/engagement/calibration/{relax|task}/{start|finish}`;
  `PUT` / `DELETE /api/engagement/calibration`.
- `GET /api/tutor`, `GET /api/webui`, `GET /chat` (→ /chat.html) — owner: side-chat.

## Window events in the page

- `paragraph:slow` / `paragraph:explain` — owner: eye-tracking (eyes.js dispatches) · used by:
  tutor.js, reader-ui.js. `detail` = `{index, text, dwellMsPer100Words?, rereads?}`.
- `neurochat:slow` — owner: eye-tracking · used by: extension/content.js (side-chat).
  `detail` = `{index, text, dwellMsPer100Words, rereads, element}`.

## Python

- `engagement_index(eeg: ch×samples µV, srate) -> float | None` — owner: engagement · used by:
  tutor, gaze, reading-signals (filtering, read only).
- `Calibration(e_min, e_max, source)`; bands low < 0.3, moderate 0.3–0.6, high ≥ 0.6 — owner: engagement.
- `reader_notes(..., engagement: Reading | None)` in tutor.py — owner: side-chat · used by: engagement.
- `SimulatedBackend(engagement=level|callable)` streams synthetic EEG the tutor trusts — owner: engagement.

## Ports and shells

- Companion + portal: 127.0.0.1:8765. Open WebUI: 127.0.0.1:3000 (model `neurochat-tutor`).
- `neurochat` command self-updates by `git pull`; flags `--simulate --skip-model --no-update --no-webui`.
- Glass UI pieces: `header.top/.brand/.steps`, `.card`, `.panel`, `button.primary`, `button.quiet`, `:root` vars; light only.
