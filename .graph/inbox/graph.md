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
