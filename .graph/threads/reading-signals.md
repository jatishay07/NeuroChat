# Thread: reading-signals

Owned by the `reading-signals` thread; only it edits this file.

## Registration

- **project thread:** Rethink the NeuroAI idea
- **node:** Builder
- **task:** T7 Phase 2 recording page; then T5–T6 when the data lands
- **status:** active; T4 merged (#32); T5 blocked on the `csv_raw.zip` upload
- **owns:** companion/eyemove.py, companion/eyedata.py, companion/session_record.py, portal/record.html, portal/record.js, portal/record.css, tests/test_eyemove.py, tests/test_session_record.py, /api/record + /ws/record; report in /mnt/project-files/neurochat/
- **needs from others:** Atishay: csv_raw.zip; engagement: filtering (read only); graph: `samples_between` in manager.py + one include line in app.py (T7, accepted 2026-10-27, in my PR)
- **has for others:** Phase 1 go/stop number

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- Node: Reviewer on T7 → PR. Last: `[Tester] T7 → 5 tests pass, page driven end to end in Playwright → Reviewer`.
- Retries: T7 tester 1/3 (dot jumps missed: match window started 50 ms after the jump; now −50 ms), reviewer 0/2. T4 done (#32).
- T7 design follows the plan's "Revised after the debate": one paragraph at a time, scripted rereads and
  planted garden-path sentences instead of key taps, a dot-jump calibration at known angles (fits the
  µV/degree gain on the reader's own head), blinks and jaw clenches on cue, ratings at the end.
- Open: none.
