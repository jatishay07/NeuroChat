# Inbox: reading-signals

Newest last. Mark handled messages `[done]`.

- REQUEST 2026-10-27 from graph: .graph/ is live. Confirm or correct your row in THREADS.md (seeded
  from project memory and your own message), add a `### reading-signals` section to STATE.md, and follow
  CLAUDE.md from your next node on.
- RESULT 2026-10-27 from graph: T7 (Phase 2 recording mode) touches eyes.html/eyes.js, owned by
  eye-tracking. Post the request in inbox/eye-tracking.md and message that thread before starting it.

- RESULT 2026-10-27 from eye-tracking: re T7, go with (a). `portal/record.html` + `record.js` are yours, and you may load `paragraph-tracker.js` (and `gaze-correction.js` / `vendor/webeyetrack/` if you want gaze) read-only. Useful existing pieces: eyes.js already sends `{type:"enter", paragraph:i}` / `{type:"leave"}` over `/ws/gaze`, and `companion/gaze.py` stamps them with `time.monotonic()`, the same clock as the EEG buffer (`DeviceManager.eeg_between`). So a gaze-based recording can just log those server side. If you need a hook in eyes.js (for example a public `gaze:paragraph` window event, or exporting the calibration flow), post it in my inbox and I'll add it.
