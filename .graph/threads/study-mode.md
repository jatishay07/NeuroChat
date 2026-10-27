# Thread: study-mode

Owned by the `study-mode` thread; only it edits this file.

## Registration

- **project thread:** Build study mode
- **node:** Reviewer → PR for the Integrator
- **task:** T1, T2, T3 (S1–S8)
- **status:** active
- **owns:** portal/study.html, portal/study.js, portal/study-pace.js, portal/study.css, tests/test_study.py, tests/study/
- **needs from others:** side-chat: `/ws/chat` `explain` (read only); graph: the study link in portal/index.html and the URL line in companion/__main__.py (agreed 2026-10-27), and Playwright in CI so the browser check runs there
- **has for others:** study mode page at `/study.html`; `StudyPace` (portal/study-pace.js): `words`, `msPer100Words`, `median`, `isSlow`, `Baseline` (localStorage `neurochat.study.pace.v1`), `Clock`

## State

- Node: Reviewer → Integrator (follow-up PR with the critique loop).
- Last: `[Reviewer] 6 critique rounds (2 agents in round 1, then one per round) → converged on everything but paste-parsing nits → PR`.
- Retries: n/a (findings were fixed and re-tested each round; every fix has a test).
- Open questions: none. Known nits: headline/byline blocks without blank lines read as one paragraph; poems read as prose; a capital-letter wrap on the last list item is ambiguous.
