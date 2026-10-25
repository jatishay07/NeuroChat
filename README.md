# NeuroChat

A tutor that notices which part of a text you're struggling with and explains it again.
It extends [NeuroChat (arXiv 2503.07599)](https://arxiv.org/abs/2503.07599), which adapted a chatbot
to a single EEG engagement score, by adding eye tracking (which paragraph you're reading) and the
Muse S Athena's fNIRS (a second, slower sign of mental effort).

Everything runs on your own computer:

| Piece | Folder | Status |
|---|---|---|
| Companion app: headset connection, signals, detector, local LLM | `companion/` | Headset connection and tutor chat (Ollama) done |
| Portal: connect screen, eye tracking, then the chat | `portal/` | Connect screen and eye-tracking test done |
| Browser extension: paragraphs and webcam gaze on any page | `extension/` | Next |

Build plan: [Struggle-Aware Tutor Build Plan](https://claude.ai/artifact/B7heEKCnARoA9t1QNRfA4D).

## Run it

Works on macOS, Windows and Linux. You only need `git` (or download the ZIP from GitHub);
everything else installs itself on the first run.

**macOS / Linux** (Terminal):

```bash
git clone https://github.com/jatishay07/NeuroChat.git
cd NeuroChat
./start.sh --simulate   # no headset: a simulated one (add --bad-channel TP10 to see a failing sensor)
./start.sh              # with a Muse S Athena
```

**Windows**: clone or unzip the repo, then double-click `start.cmd`, or in PowerShell:

```powershell
.\start.cmd --simulate
```

The first run takes a few minutes. It:

1. uses Python 3.11+ if you have it, or downloads one with [uv](https://docs.astral.sh/uv/) (no admin rights needed);
2. sets up a virtualenv in `.venv` and installs the companion app;
3. installs [Ollama](https://ollama.com) if it's missing, or updates it if it's too old for the model
   (`curl -fsSL https://ollama.com/install.sh | sh` on macOS and Linux, the installer on Windows);
4. downloads the local model, **Qwen3.5 4B** (3.3 GB, runs on 8 GB of RAM).

It also installs a **`neurochat` command**. From then on, open any terminal and type:

```bash
neurochat
```

Every run pulls the latest version from GitHub first (skipped when offline or if you've changed
files), then starts. Later runs start in seconds. Keep the window open while you use it: the portal at
http://127.0.0.1:8765 opens in your browser and only works while the companion is running.

- `--simulate` uses a fake headset; `--skip-model` skips Ollama and the model; `--no-update` skips the update.
- `NEUROCHAT_MODEL=qwen3.5:2b-q4_K_M` picks a smaller model (1.9 GB) for older machines;
  `qwen3.5:9b` (6.6 GB) gives better answers on 16 GB machines.

<details>
<summary>Manual setup instead</summary>

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"            # add ,hardware for a real headset: ".[dev,hardware]"
python -m companion --simulate     # or: python -m companion
```
</details>

Click **Find my headset**, and connect. No headset with you? Click **Skip to eye tracking**: it
calibrates [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) on your webcam (video never leaves the browser)
and shows how long you spend on each paragraph of a test passage. When a paragraph takes you much
longer than the rest, the tutor offers to explain it with the local model (streamed over
`/ws/chat`), and you can ask follow-up questions.

With a real headset, close the Muse app first (the headset talks to one app at a time).
The companion scans over Bluetooth LE with [bleak](https://github.com/hbldh/bleak), starts
[OpenMuse](https://github.com/DominiqueMakowski/OpenMuse) to stream the headset onto Lab Streaming
Layer, and reads the EEG stream back with pylsl. On macOS, the terminal running it needs
Bluetooth permission (System Settings → Privacy & Security → Bluetooth). On Linux, pylsl also
needs liblsl (`conda install -c conda-forge liblsl`, or the package from the
[liblsl releases](https://github.com/sccn/liblsl/releases)).

## Run it with Docker

One download with everything inside: the app, Ollama with the Qwen3.5 4B model, and
[Open WebUI](https://github.com/open-webui/open-webui). With [Docker](https://www.docker.com/products/docker-desktop/) installed:

```bash
docker run -d --name neurochat -p 127.0.0.1:8765:8765 -p 127.0.0.1:3000:3000 \
  -v neurochat:/app/backend/data ghcr.io/jatishay07/neurochat
```

Then open http://127.0.0.1:8765 for the app and http://127.0.0.1:3000 for Open WebUI. The first
download is about 10 GB; after that it starts in under a minute and works offline.
`docker stop neurochat` stops it and `docker start neurochat` starts it again, with your chats kept.
From a clone, `docker compose up` does the same (`docker compose up --build` builds it from your copy).

- **Simulated headset only, for now.** Docker on macOS and Windows can't reach Bluetooth, so the
  container uses the fake headset. For a real Muse S Athena, use `./start.sh` or `start.cmd`.
- **Speed.** On a Mac, Ollama inside Docker runs on the CPU (Docker can't use Apple's GPU), so answers
  are slower than with `./start.sh`. With an NVIDIA GPU on Linux or Windows, add `--gpus all`.
- Both ports listen on this computer only. The image is rebuilt and published from `main` by
  `.github/workflows/docker.yml`; `docker build --build-arg MODEL=qwen3.5:2b-q4_K_M .` bakes in another model.

## Tests

```bash
pytest
```

## Data

Recordings are biometric data. `data/` and `*.xdf` are ignored by git; never commit them.
