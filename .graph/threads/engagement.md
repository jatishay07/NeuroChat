# Thread: engagement

Owned by the `engagement` thread; only it edits this file.

## Registration

- **project thread:** Turn engagement scores into prompts
- **node:** idle
- **task:** PR #25 merged; T9 next
- **status:** active (confirmed 2026-10-27)
- **owns:** companion/engagement.py, synthetic.py, recording.py, realdata.py, e2e.py, tests/test_engagement.py, test_e2e.py, test_realdata.py
- **needs from others:** Atishay: ~10 min labelled Athena data (T9)
- **has for others:** engagement API, SimulatedBackend(engagement=)

## State

Current node, last handoff line, retry counters (Tester n/3, Reviewer n/2), open questions.

- Node: idle (T9 waits on Athena data). Last: `[Integrator] PR #25 kernel + bands + real-data check → merged → idle`.
- Retries: none open.
- Done: kernel per paper §3.2, 3 bands (0.3 / 0.6) in the Qwen prompt, synthetic + real-file loaders, e2e
  in Docker CI with real Qwen. Real Muse data (Bird et al. 2018): direction right (concentrating > neutral, 3/4),
  bands read too low because the max-based E_max is an outlier; notes in /mnt/project-files/neurochat/real-eeg-test.md.
- Next: T9 when Atishay sends ~10 min labelled Athena data (calm + focused stretches). T8 is free for any thread;
  the API it needs is in CONTRACTS (engagement section of my THREADS row).
