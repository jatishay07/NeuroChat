# STATE

First thing every node reads. Only the Integrator edits it; threads report in `.graph/threads/<id>.md`.
Last updated: 2026-10-27 23:30Z by graph (Integrator).

## Project

- **Current milestone:** 1, study mode: first version merged (#33). The study-mode thread is running a
  critique loop Atishay asked for; its fixes (from 538965e) come as a follow-up PR. Milestone 2: T4 and T7 merged.
- **main:** merged today #26, #28–#34. Open: #27 public-repo (green, held until Atishay picks a license).
- **Last full suite:** 2026-10-27 on #34's merge head `8afe5eb`: `pytest -q` → 74 passed, 1 skipped,
  study-mode browser check included; Docker build + real-Qwen smoke green in CI.
- **Blocked:** Phase 1 data. Zenodo is blocked from cloud sessions; Atishay is uploading `csv_raw.zip`
  (228 MB) to the project files. Not there yet as of 2026-10-27 22:30Z.

### Task graph

| id | task | milestone | owner | status | depends on |
|---|---|---|---|---|---|
| T1 | Study mode reader page (S1–S7) | 1 | study-mode | merged #33; critique fixes pending | — |
| T2 | Personal pace baseline + slow cue (S2–S4) | 1 | study-mode | merged #33 | T1 |
| T3 | Wire study mode into home, `neurochat`, Docker (S8) | 1 | study-mode | merged #33 | T1 |
| T4 | Eye-movement detectors (P1) | 2 | reading-signals | merged #32 | — |
| T5 | Score on Afonso & Heinrichs data (P2, P3) | 2 | reading-signals | blocked: data upload | T4 |
| T6 | Go/stop decision (P4) | 2 | reading-signals → Atishay | todo | T5 |
| T7 | Recording page for Phase 2 (portal/record.html, /ws/record) | 2 | reading-signals | merged #34 | before next week's recording |
| T8 | Portal calibration screen for the engagement kernel | side | unassigned | todo | — |
| T9 | Tune engagement band edges on real Athena data | side | engagement | waiting: Athena data | — |
| T10 | Make webcam gaze usable (Atishay: "still not great or usable", 2026-10-26) | side | eye-tracking | in progress | his accuracy numbers |

### Open questions (for Atishay)

- Which license for the public repo? (public-repo; blocks #27)
- Side chat outside Chrome (desktop window): recommended later, with the desktop app. (side-chat)

## Threads

Each thread keeps its own state in `.graph/threads/<id>.md` (section "State"). This file holds only the
project-level state above, which the Integrator maintains.
