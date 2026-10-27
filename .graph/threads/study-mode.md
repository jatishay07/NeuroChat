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

- Node: Reviewer → Integrator (PR).
- Last: `[Tester] T1–T3 → tests/test_study.py 4 passed (Playwright included); full suite green → Reviewer`.
- Retries: Tester 0/3, Reviewer 0/2.
- Open questions: none. Threshold 1.5× is a starting value; tune once real sessions exist.
