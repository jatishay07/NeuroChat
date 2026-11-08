# Inbox: graph (Integrator)

Newest last. Mark handled messages `[done]`.

- [done] RESULT 2026-10-27 from engagement: owns engagement.py, synthetic.py, recording.py,
  realdata.py, e2e.py + tests; contracts and open tasks (calibration screen, band tuning). Recorded.
- [done] RESULT 2026-10-27 from reading-signals: Phase 1 files (eyemove.py, eyedata.py,
  test_eyemove.py), depends on engagement filtering read-only. Recorded.
- [done] RESULT 2026-10-27 from side-chat: owns tutor/webui, /ws/chat, tutor.js|css, extension.
  Open question on desktop side chat. Recorded.
- RESULT 2026-10-27 from study-mode: T1–T3 in the study-mode PR (registration in .graph/threads/study-mode.md).
  Touches portal/index.html (link) and companion/__main__.py (prints the study URL), as agreed.
- REQUEST 2026-10-27 from study-mode: tests/test_study.py's browser check skips without Node Playwright.
  In tests.yml, after pip install, please add `npm i -g playwright@1.48 && npx playwright install --with-deps chromium`
  so S5/S6 are checked in CI (it finds the global install via `npm root -g`).
- REQUEST 2026-10-27 from reading-signals: T7 recording page needs two small touches to files you own
  (interim), both in my T7 PR for you to accept or reject: (1) `companion/device/manager.py`: public
  `samples_between(t0, t1) -> (times, eeg)` next to `eeg_between` (read only; a 20-minute recording
  outlives the 180 s buffer, so the recorder copies EEG out every second with each sample's monotonic
  time); (2) `companion/app.py`: one `app.include_router(record_router(device))` line. Everything else
  is new and mine: `companion/session_record.py`, `portal/record.html|js|css`,
  `tests/test_session_record.py`; contract added to CONTRACTS.md.
- REQUEST 2026-10-28 from style: register thread `style` (.graph/threads/style.md) and review the
  Google-style PR. It adds .github/workflows/lint.yml (your folder; new file only) and reformats your
  interim files (start.sh, docker/entrypoint.sh, portal/*). It conflicts with #42 only in formatting:
  either order works, the second one takes its own side and runs scripts/format.sh. .graph/ and
  CLAUDE.md are deliberately not reformatted.
- REQUEST 2026-11-08 from style: S-2 code layout PR (draft until #42 merges, Atishay picked that order). Please update the owns column in THREADS.md and file paths in CONTRACTS.md when you merge it.
  Python: companion/ → src/neurochat/ (`python -m neurochat`): app.py, __main__.py, device/ (same files);
  signals/ = engagement, eyemove, gaze, recording, synthetic; chat/ = tutor, webui;
  research/ = e2e, eyedata, realdata, session_record. Imports are absolute (`from neurochat.signals.engagement import …`).
  Portal: page URLs unchanged; scripts/styles move next to their page: study/, eyes/, record/, chat/,
  connect/ (index.html: app.js, bluetooth.js), shared/ (style.css, reader.css, reader-ui.js, tutor.js, tutor.css).
  After it merges: merge main; git follows the renames, so your edits normally land in the moved files.
