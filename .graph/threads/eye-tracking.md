# Thread: eye-tracking

Owned by the `eye-tracking` thread; only it edits this file.

## Registration

- **project thread:** Get eye tracking working well
- **node:** Builder
- **task:** T10 make webcam gaze usable; T7 recording mode with reading-signals when asked
- **status:** active, waiting on Atishay's accuracy numbers (PR #24 merged); extension gaze paused (WIP patch in project files)
- **owns:** portal/eyes.html (markup took over from glass-ui), eyes.js, gaze.css, paragraph-tracker.js, gaze-correction.js, portal/vendor/, portal/web/, companion/gaze.py, /ws/gaze + GET /api/gaze in companion/app.py, extension/gaze/ (+ its manifest entries), tests/test_gaze.py
- **needs from others:** Atishay: one real accuracy line on the MacBook (px off, px up/down)
- **has for others:** `paragraph:slow` / `paragraph:explain` / `neurochat:slow` events; /ws/gaze visits with EEG engagement; T7 hooks in eyes.html/eyes.js on request

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- Node: Builder (T10), idle until Atishay's accuracy numbers arrive. Retries: Tester 0/3, Reviewer 0/2.
- Last: `[Integrator] PR #24 correction layer + follow-the-dot → merged → Builder (waiting on real accuracy)`.
- Simulation (not a real face): correct paragraph 82% → 87% with the HMM; gaze error 70 → 48 px, 155 → 60 px after a 10 cm head move.
- Open: real-face accuracy on the MacBook is unknown. Extension gaze paused: the offscreen document's video never gets a stream.
- T7: ready to add a recording mode to eyes.html/eyes.js once reading-signals posts the request.
