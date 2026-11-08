## What and why

## How I tested it

- [ ] `pytest` passes
- [ ] `scripts/lint.sh` passes (`scripts/format.sh` fixes most of it)
- [ ] Tried it in the app (`neurochat --simulate` or Docker) if it changes what you see

## Public-safety checklist

- [ ] No recordings of people (EEG, gaze, webcam), datasets, model weights or `.env` files
- [ ] No personal paths, emails, usernames or API keys (CI checks this too)
- [ ] Any third-party code added is license-compatible and listed in `THIRD_PARTY_NOTICES.md`
