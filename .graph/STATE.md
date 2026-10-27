# STATE

First thing every node reads. Each thread edits only its own section; Integrator edits "Project".
Last updated: 2026-10-27 by graph (Integrator).

## Project

- **Current milestone:** 1, study mode. **No thread owns it yet** (task T1 below is unassigned).
- **main:** `8c81218` (PR #25 merged). No open PRs.
- **Last full suite:** 2026-10-27 on `8c81218`: `pytest -q` → 52 passed, 1 skipped (71 s). Docker CI
  last green on PR #25.
- **Blocked:** Phase 1 data. Zenodo is blocked from cloud sessions; Atishay is uploading `csv_raw.zip`
  (228 MB) to the project files. Not there yet as of 2026-10-27 22:30Z.

### Task graph

| id | task | milestone | owner | status | depends on |
|---|---|---|---|---|---|
| T1 | Study mode reader page (S1–S7) | 1 | unassigned | todo | — |
| T2 | Personal pace baseline + slow cue (S2–S4) | 1 | with T1 | todo | T1 |
| T3 | Wire study mode into home, `neurochat`, Docker (S8) | 1 | unassigned | todo | T1 |
| T4 | Eye-movement detectors (P1) | 2 | reading-signals | in progress | — |
| T5 | Score on Afonso & Heinrichs data (P2, P3) | 2 | reading-signals | blocked: data upload | T4 |
| T6 | Go/stop decision (P4) | 2 | reading-signals → Atishay | todo | T5 |
| T7 | Recording mode for Phase 2 (needs eyes.html/eyes.js) | 2 | reading-signals + eye-tracking | todo | before next week's recording |
| T8 | Portal calibration screen for the engagement kernel | side | unassigned | todo | — |
| T9 | Tune engagement band edges on real Athena data | side | engagement | waiting: Athena data | — |
| T10 | Make webcam gaze usable (Atishay: "still not great or usable", 2026-10-26) | side | eye-tracking | in progress | his accuracy numbers |

### Open questions (for Atishay)

- Who builds study mode: a new thread, or the eye-tracking thread (it owns the reader page)?
  Recommendation: a new "Build study mode" thread with new files, so eye tracking stays separate.
- Side chat outside Chrome (desktop window): recommended later, with the desktop app. (side-chat)

## Threads

Each thread adds a `### <thread-id>` section here: current node, last handoff line, retry counters.

### graph
- Node: Integrator. Last: `[Builder] seed CLAUDE.md + .graph → PR opened → Integrator`.
