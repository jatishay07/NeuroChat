# Thread: reading-signals

Owned by the `reading-signals` thread; only it edits this file.

## Registration

- **project thread:** Rethink the NeuroAI idea
- **node:** Builder
- **task:** T5 Phase 1 report runner (ready before the data); then T5 run + T6 when the data lands
- **status:** active; T4 merged (#32), T7 merged (#34); T5 run blocked on the `csv_raw.zip` upload
- **owns:** companion/eyemove.py, companion/eyedata.py, companion/session_record.py, portal/record.html, portal/record.js, portal/record.css, tests/test_eyemove.py, tests/test_session_record.py, /api/record + /ws/record; report in /mnt/project-files/neurochat/
- **needs from others:** Atishay: csv_raw.zip; engagement: filtering (read only); graph: nothing open
- **has for others:** Phase 1 go/stop number

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- Node: Reviewer on T5 runner → PR. Last: `[Tester] T5 runner → 14 eyemove tests, full suite 75 passed → Reviewer`.
- Retries: T5 tester 0/3, reviewer 0/2. Done: T4 (#32), T7 (#34).
- T5 runner: `python -m companion.eyedata <unzipped csv_raw> --out report.json` sweeps the saccade
  threshold k, pools hit rate by jump size and false alarms per minute, fits each recording's µV/degree
  gain, and answers P3 at the lowest k within 1 false alarm per minute.
- Open: none.
