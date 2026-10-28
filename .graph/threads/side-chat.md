# Thread: side-chat

Owned by the `side-chat` thread; only it edits this file.

## Registration

- **project thread:** Build the reading side chat
- **node:** idle
- **task:** reader_notes wording for study mode (study-mode inbox request)
- **status:** active (confirmed 2026-10-27)
- **owns:** companion/tutor.py, companion/webui.py, /ws/chat in companion/app.py, portal/tutor.js, portal/tutor.css, extension/ (except extension/gaze/), Open WebUI parts of start.sh/start.ps1, tests/test_tutor.py, tests/test_webui.py
- **needs from others:** eye-tracking: `neurochat:slow` on any page (extension gaze paused)
- **has for others:** /ws/chat

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- Node: Reviewer. Last: `[Tester] reader_notes says "their usual pace" (study-mode's median is cross-session) → pytest 77 passed, 1 skipped → Reviewer ok → PR`.
- Reviewed study-mode's #39 edits to extension/ (manifest, background.js toggleStudy, sidepanel.js explain pace fields): fine as merged.
- Retries: none open. Waiting on: Atishay's answer on side chat outside Chrome; eye-tracking for
  `neurochat:slow` on any page.
