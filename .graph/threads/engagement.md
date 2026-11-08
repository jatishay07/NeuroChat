# Thread: engagement

Owned by the `engagement` thread; only it edits this file.

## Registration

- **project thread:** Turn engagement scores into prompts
- **node:** Reviewer → Integrator
- **task:** T11 signals page in the extension (sample data only); T9 next
- **status:** active (confirmed 2026-10-27)
- **owns:** companion/engagement.py, synthetic.py, recording.py, realdata.py, e2e.py, extension/signals/, /api/engagement/* in companion/app.py, tests/test_engagement.py, test_e2e.py, test_realdata.py, test_signals.py, tests/signals/
- **needs from others:** Atishay: ~10 min labelled Athena data (T9)
- **has for others:** engagement API (incl. /api/engagement/signals and /prompt), SimulatedBackend(engagement=), RecordingBackend / `--replay bird|FILES`

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- 2026-11-08 T11 (Atishay: show the α/β waves and the system prompt in the extension, sample data only):
  `[Builder] signals page + /api/engagement/signals,/prompt + --replay → [Tester] 88 passed, Playwright page check + video → [Reviewer] ok → PR`.
  Touched outside my files: extension/sidepanel.html/.js/.css (one header button; side-chat told), companion/__main__.py (--replay flag; graph told), companion/app.py (/api/engagement/* and app.state.last_prompt set in /ws/chat; side-chat told).
  Atishay's student_engagement_dataset.csv (Kaggle) was checked and dropped: uniform 0.5–2.5 band powers, labels uncorrelated with the signals, no raw EEG.
- Node before that: idle (T9 waits on Athena data). Last: `[Integrator] PR #25 kernel + bands + real-data check → merged → idle`.
- Retries: none open.
- Done: kernel per paper §3.2, 3 bands (0.3 / 0.6) in the Qwen prompt, synthetic + real-file loaders, e2e
  in Docker CI with real Qwen. Real Muse data (Bird et al. 2018): direction right (concentrating > neutral, 3/4),
  bands read too low because the max-based E_max is an outlier; notes in /mnt/project-files/neurochat/real-eeg-test.md.
- Next: T9 when Atishay sends ~10 min labelled Athena data (calm + focused stretches). T8 is free for any thread;
  the API it needs is in CONTRACTS (engagement section of my THREADS row).
