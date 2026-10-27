# Security

## Reporting a problem

Please **don't open a public issue**. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/jatishay07/NeuroChat/security/advisories/new).
You'll get a reply within a week. This is a hobby research project, so there's no bug bounty.

## What NeuroChat does to keep you safe

- **Everything stays on your computer.** The companion (port 8765) and Open WebUI (port 3000) listen
  on 127.0.0.1 only, also in Docker (`-p 127.0.0.1:...`). Webcam video never leaves the browser.
  The app keeps EEG and gaze in memory and doesn't write them to disk; only command-line tools you run
  yourself write files, where you tell them to. Chats are kept on your computer (Open WebUI's data
  folder, and the extension's own storage in Chrome).
- **Other websites can't use it.** The companion refuses requests and WebSockets from any origin except
  its own pages, Open WebUI on localhost and the browser extension, and refuses host names other than
  localhost (against DNS rebinding). `NEUROCHAT_ALLOWED_HOSTS` adds host names if you deliberately
  expose it on your network; don't do that on a network you don't trust.
- **Open WebUI runs without sign-in**, because it's for one person on one computer. Don't publish its
  port beyond 127.0.0.1.
- **Your own model server.** `NEUROCHAT_LLM_API_KEY` is read from the environment and only sent to
  `NEUROCHAT_LLM_URL`. Don't put keys in files inside the repo; `.env` files are git-ignored.

## Things to know before you run it

- `neurochat` / `start.sh` **updates itself from `main` on every run** (`git pull --ff-only`), and on the
  first run installs uv, Ollama and Open WebUI from their official sources. Use `--no-update` to pin
  the version you have, and read `start.sh` first if you prefer.
- The Docker image is rebuilt from `main` and published to `ghcr.io/jatishay07/neurochat`.

## Supported versions

Only the latest `main` and the latest Docker image get fixes.
