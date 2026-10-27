# THREADS

One row per thread. Each thread edits only its own row (and posts needs into other threads' inboxes).
Check "Owns" before touching a file. Thread id = inbox name (`.graph/inbox/<id>.md`).
Seeded 2026-10-27 by graph from project memory and the threads' own messages; each thread confirms its row.

## Active

| id | project thread | node | task | status | owns | needs from others | has for others |
|---|---|---|---|---|---|---|---|
| graph | Set up graph engineering workflow | Integrator | merge passing work, run full suite, keep .graph/ tidy | active | CLAUDE.md, .graph/ (except own rows/sections/inboxes), .github/workflows/ (except public-safety.yml); **interim owner** of Dockerfile, docker-compose.yml, docker/, start.sh/start.ps1/start.cmd (non-Open-WebUI parts), companion/app.py (non-/ws/chat parts), companion/device/, portal/app.js, portal/bluetooth.js, portal/index.html, portal/style.css, portal/reader.css, portal/reader-ui.js, portal/chat.html, portal/chat.css until a thread claims them | every thread: register here | merges, suite results |
| eye-tracking | Get eye tracking working well | Builder | T10 make webcam gaze usable; T7 recording mode with reading-signals when asked | active, waiting on Atishay's accuracy numbers (PR #24 merged); extension gaze paused (WIP patch in project files) | portal/eyes.html (markup took over from glass-ui), eyes.js, gaze.css, paragraph-tracker.js, gaze-correction.js, portal/vendor/, portal/web/, companion/gaze.py, /ws/gaze + GET /api/gaze in companion/app.py, extension/gaze/ (+ its manifest entries), tests/test_gaze.py | Atishay: one real accuracy line on the MacBook (px off, px up/down) | `paragraph:slow` / `paragraph:explain` / `neurochat:slow` events; /ws/gaze visits with EEG engagement; T7 hooks in eyes.html/eyes.js on request |
| side-chat | Build the reading side chat | idle | PR #22 merged, nothing in flight | active (confirmed 2026-10-27) | companion/tutor.py, companion/webui.py, /ws/chat in companion/app.py, portal/tutor.js, portal/tutor.css, extension/ (except extension/gaze/), Open WebUI parts of start.sh/start.ps1, tests/test_tutor.py, tests/test_webui.py | eye-tracking: `neurochat:slow` on any page (extension gaze paused) | /ws/chat |
| engagement | Turn engagement scores into prompts | idle | PR #25 merged | active | companion/engagement.py, synthetic.py, recording.py, realdata.py, e2e.py, tests/test_engagement.py, test_e2e.py, test_realdata.py | Atishay: ~10 min labelled Athena data (T9) | engagement API, SimulatedBackend(engagement=) |
| reading-signals | Rethink the NeuroAI idea | Builder | T4–T6 Phase 1: eye-movement detectors on AF7/AF8, TP9/TP10 | active, data upload pending | companion/eyemove.py, companion/eyedata.py, tests/test_eyemove.py (all new); report in /mnt/project-files/neurochat/ | Atishay: csv_raw.zip; engagement: filtering (read only); eye-tracking: reader page for T7 recording mode | Phase 1 go/stop number |
| public-repo | Prepare repo to go public | Builder | LICENSE, README, CONTRIBUTING, SECURITY, issue templates, public-safety CI, configurable model (Ollama or OpenAI-compatible) | active | LICENSE, THIRD_PARTY_NOTICES.md, CONTRIBUTING.md, SECURITY.md, .github/ISSUE_TEMPLATE/, .github/workflows/public-safety.yml, scripts/public_safety.py, README.md | side-chat: touches companion/tutor.py (model config); graph: touches start.sh/start.ps1 model parts, docker/entrypoint.sh | public-safety check on every PR |

## Unassigned work

- **T1–T3 study mode** (milestone 1). Proposed files, all new: `portal/study.html`, `portal/study.js`,
  `portal/study.css`, `tests/test_study*.py`. Reuses `/ws/chat` (side-chat contract) read-only.
- **T8** portal calibration screen for the engagement kernel.

## Finished (no longer active)

| id | project thread | what it left |
|---|---|---|
| build | Understand and recreate paper | companion, headset (bleak + Web Bluetooth), Docker image + CI; ownership passed to graph (interim) |
| glass-ui | Design light-mode glass UI | style.css, reader.css, reader-ui.js, chat.html/css; canvas https://claude.ai/artifact/HRZK67SUdTDLrfkKkwrJqY |
| debate | Debate the reading signals plan | the "Revised after the debate" section of the plan; study mode first |
