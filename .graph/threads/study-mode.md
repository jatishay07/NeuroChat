# Thread: study-mode

Owned by the `study-mode` thread; only it edits this file.

## Registration

- **project thread:** Build study mode
- **node:** Reviewer → PR for the Integrator
- **task:** T1, T2, T3 (S1–S8)
- **status:** active
- **owns:** extension/study/, portal/study.html, portal/study.js, portal/study-pace.js, portal/study.css, tests/test_study.py, tests/study/
- **needs from others:** side-chat: `/ws/chat` `explain` (read only); graph: the study link in portal/index.html and the URL line in companion/__main__.py (agreed 2026-10-27), and Playwright in CI so the browser check runs there
- **has for others:** study mode page at `/study.html`; `StudyPace` (portal/study-pace.js): `words`, `msPer100Words`, `median`, `isSlow`, `Baseline` (localStorage `neurochat.study.pace.v1`), `Clock`

## State

- Node: Reviewer → Integrator (follow-up PR with the critique loop).
- Last: `[Reviewer] 6 critique rounds (2 agents in round 1, then one per round) → converged on everything but paste-parsing nits → PR`.
- Retries: n/a (findings were fixed and re-tested each round; every fix has a test).
- Open questions: none. Known nits: headline/byline blocks without blank lines read as one paragraph; poems read as prose; a capital-letter wrap on the last list item is ambiguous.

## 2026-10-28: study mode in the extension

- Node: Reviewer → Integrator. `[Reviewer] 2 critique rounds on the extension → fixed (round 2 nit: phone pill overlap, not worth it) → PR`.
- Edits to side-chat files flagged in its inbox (manifest, background.js, sidepanel.js explain()).
- Tests: tests/study/extension.mjs (news page, tricky real-site shapes, empty page); demo video by tests/study/record-extension.mjs.
- Open question for Atishay: focus mode only, passive, or both (decision card); building focus mode meanwhile.
- 2026-10-28: #39 merged (0d7e416). Integrator asked about the two pace-engine copies: `test_extension_uses_the_same_pace_engine` fails on any byte difference, so they can't drift. Follow-up: the Explain handoff check in tests/study/extension.mjs raced the side panel deleting `pending` (seen on #40), so it now listens for the storage write instead of polling.

## 2026-10-28: 13 features before the headset

- Node: Reviewer → draft PR. `[Reviewer] 3 critique rounds → fixed each round → 79 passed, 1 skipped → draft PR, waiting on Atishay's picks`.
- No READY until Atishay says which features to keep; unpicked ones get removed before merge.
- Video: tests/study/record-features.mjs (stand-in tutor, simulator for headset signals).
- Edits to side-chat and companion files flagged in its inbox.
