# Contributing to NeuroChat

Thanks for helping! NeuroChat is a small research project: a reading tutor that notices which part of
a text you're stuck on and explains it again, running entirely on your own computer.

## Set up

```bash
git clone https://github.com/jatishay07/NeuroChat.git
cd NeuroChat
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
pytest                                            # unit tests and an end-to-end check with a stand-in model
scripts/format.sh                                 # format to the Google style guides (docs/style.md)
python -m companion --simulate                    # the app at http://127.0.0.1:8765, no headset needed
```

You don't need a headset or a GPU: `--simulate` fakes the Muse, and the tutor runs on any model you
point it at (see "Use your own model" in the README). While developing, run `./start.sh --no-update`
so it doesn't pull `main` over your changes.

## Where things are

| Folder                  | What                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `companion/`            | Python app (FastAPI): headset, engagement score, gaze, tutor, Open WebUI bridge               |
| `companion/device/`     | Muse S Athena connection: Bluetooth backends, packet decoding, signal quality                 |
| `portal/`               | The web pages the companion serves: study mode, connect, eye tracking, reader, chat           |
| `portal/vendor/`        | Third-party browser code (WebEyeTrack, MediaPipe), kept as upstream ships it                  |
| `extension/`            | Chrome extension: side chat and study mode on any page                                        |
| `docker/`, `Dockerfile` | The all-in-one image                                                                          |
| `scripts/`              | Repo tools: `format.sh`, `lint.sh`, `public_safety.py`                                        |
| `tests/`                | `pytest`; `tests/study/` holds the Node/Playwright browser checks that `pytest` runs          |
| `docs/`                 | Longer docs: [code style](docs/style.md), [engagement score](docs/engagement.md)              |
| `start.sh`, `start.cmd` | The one-command start (and the `neurochat` command); they stay at the top so it keeps working |

`CLAUDE.md` and `.graph/` hold the plan and working notes that the maintainer's AI coding sessions
share. You can read them for context; you don't need to update them.

## Code style

Everything follows the [Google style guides](https://google.github.io/styleguide/), applied by
formatters: run `scripts/format.sh` before you commit, and `scripts/lint.sh` (which CI runs) must
pass. The details, and what the tools don't catch, are in [docs/style.md](docs/style.md).

## Pull requests

- Keep each PR to one change, with a test when it changes behaviour.
- `pytest`, `scripts/lint.sh` and the **Public safety** check must pass. That check rejects recordings, data files,
  `.env` files, personal home-folder paths and email addresses, and gitleaks scans for secrets.
- **Never commit recordings of people** (EEG, gaze, webcam) or datasets. They're biometric data.
  Write a downloader like `companion/realdata.py` instead, and only for data whose license allows it.
- Third-party code needs an MIT/BSD/Apache-compatible license; add it to `THIRD_PARTY_NOTICES.md`.
- Don't rebrand Open WebUI (its license forbids it for larger deployments).

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

By contributing you agree that your work is released under the project's license (`LICENSE`).
