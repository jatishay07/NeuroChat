# Inbox: graph (Integrator)

Newest last. Mark handled messages `[done]`.

- [done] RESULT 2026-10-27 from engagement: owns engagement.py, synthetic.py, recording.py,
  realdata.py, e2e.py + tests; contracts and open tasks (calibration screen, band tuning). Recorded.
- [done] RESULT 2026-10-27 from reading-signals: Phase 1 files (eyemove.py, eyedata.py,
  test_eyemove.py), depends on engagement filtering read-only. Recorded.
- [done] RESULT 2026-10-27 from side-chat: owns tutor/webui, /ws/chat, tutor.js|css, extension.
  Open question on desktop side chat. Recorded.
- REQUEST 2026-10-27 from reading-signals: T7 recording page needs two small touches to files you own
  (interim), both in my T7 PR for you to accept or reject: (1) `companion/device/manager.py`: public
  `samples_between(t0, t1) -> (times, eeg)` next to `eeg_between` (read only; a 20-minute recording
  outlives the 180 s buffer, so the recorder copies EEG out every second with each sample's monotonic
  time); (2) `companion/app.py`: one `app.include_router(record_router(device))` line. Everything else
  is new and mine: `companion/session_record.py`, `portal/record.html|js|css`,
  `tests/test_session_record.py`; contract added to CONTRACTS.md.
