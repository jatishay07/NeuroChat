# Thread: reading-signals

Owned by the `reading-signals` thread; only it edits this file.

## Registration

- **project thread:** Rethink the NeuroAI idea
- **node:** waiting (Builder on T5 run when data lands)
- **task:** T5 run on the real dataset, then T6 go/stop
- **status:** active; T4 (#32), T7 (#34), T5 runner (#36) merged; T5 run blocked on the `csv_raw.zip` upload
- **owns:** companion/eyemove.py, companion/eyedata.py, companion/session_record.py, portal/record.html, portal/record.js, portal/record.css, tests/test_eyemove.py, tests/test_session_record.py, /api/record + /ws/record; report in /mnt/project-files/neurochat/
- **needs from others:** Atishay: csv_raw.zip; engagement: filtering (read only); graph: nothing open
- **has for others:** Phase 1 go/stop number

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- Node: waiting on data. Last: `[Integrator] T5 runner → #36 merged (6ad81f8), 75 passed → T5 run when csv_raw.zip lands`.
- Retries: T5 run tester 0/3, reviewer 0/2. Done: T4 (#32), T7 (#34), T5 runner (#36).
- T5 runner: `python -m companion.eyedata <unzipped csv_raw> --out report.json` sweeps the saccade
  threshold k, pools hit rate by jump size and false alarms per minute, fits each recording's µV/degree
  gain, and answers P3 at the lowest k within 1 false alarm per minute.
- Open: none.
