# THREADS

Index of every thread. **Each thread's own file `.graph/threads/<id>.md` is the source of truth**
(registration, needs, offers, state); only that thread edits it. The Integrator refreshes this index
when it merges, so threads never edit the same lines and registrations don't conflict.
Check "owns" before touching a file. Thread id = inbox name (`.graph/inbox/<id>.md`).

## Active

| id | project thread | node | status | owns | file |
|---|---|---|---|---|---|
| graph | Set up graph engineering workflow | Integrator | active | CLAUDE.md, .graph/ (except own rows/sections/inboxes), .github/workflows/ (except public-safety.yml); **interim owner** of Dockerfile, docker-compose.yml, docker/, start.sh/start.ps1/start.cmd (non-Open-WebUI parts), companion/app.py (non-/ws/chat parts), companion/device/, portal/app.js, portal/bluetooth.js, portal/index.html, portal/style.css, portal/reader.css, portal/reader-ui.js, portal/chat.html, portal/chat.css until a thread claims them | [threads/graph.md](threads/graph.md) |
| eye-tracking | Get eye tracking working well | Builder | active, waiting on Atishay's accuracy numbers (PR #24 merged); extension gaze paused (WIP patch in project files) | portal/eyes.html (markup took over from glass-ui), eyes.js, gaze.css, paragraph-tracker.js, gaze-correction.js, portal/vendor/, portal/web/, companion/gaze.py, /ws/gaze + GET /api/gaze in companion/app.py, extension/gaze/ (+ its manifest entries), tests/test_gaze.py | [threads/eye-tracking.md](threads/eye-tracking.md) |
| side-chat | Build the reading side chat | idle | active (confirmed 2026-10-27) | companion/tutor.py, companion/webui.py, /ws/chat in companion/app.py, portal/tutor.js, portal/tutor.css, extension/ (except extension/gaze/), Open WebUI parts of start.sh/start.ps1, tests/test_tutor.py, tests/test_webui.py | [threads/side-chat.md](threads/side-chat.md) |
| engagement | Turn engagement scores into prompts | idle | active (confirmed 2026-10-27) | companion/engagement.py, synthetic.py, recording.py, realdata.py, e2e.py, tests/test_engagement.py, test_e2e.py, test_realdata.py | [threads/engagement.md](threads/engagement.md) |
| reading-signals | Rethink the NeuroAI idea | Builder | active, data upload pending | companion/eyemove.py, companion/eyedata.py, tests/test_eyemove.py (all new); report in /mnt/project-files/neurochat/ | [threads/reading-signals.md](threads/reading-signals.md) |
| public-repo | Prepare repo to go public | Builder | active | LICENSE, THIRD_PARTY_NOTICES.md, CONTRIBUTING.md, SECURITY.md, .github/ISSUE_TEMPLATE/, .github/workflows/public-safety.yml, scripts/public_safety.py, README.md | [threads/public-repo.md](threads/public-repo.md) |
| study-mode | Build study mode | registering | T1–T3 | portal/study.html, study.js, study.css, tests for them (all new) | threads/study-mode.md (pending) |

To register: copy `threads/_template.md` to `threads/<id>.md`, fill it in, open a PR, and message `graph`.

## Unassigned work

- **T8** portal calibration screen for the engagement kernel.

## Finished (no longer active)

| id | project thread | what it left |
|---|---|---|
| build | Understand and recreate paper | companion, headset (bleak + Web Bluetooth), Docker image + CI; ownership passed to graph (interim) |
| glass-ui | Design light-mode glass UI | style.css, reader.css, reader-ui.js, chat.html/css; canvas https://claude.ai/artifact/HRZK67SUdTDLrfkKkwrJqY |
| debate | Debate the reading signals plan | the "Revised after the debate" section of the plan; study mode first |
