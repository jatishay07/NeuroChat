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
| Chat portal: [Open WebUI](https://openwebui.com), for carrying on conversations | started by `neurochat` | Done |
| Side chat: Chrome extension that explains what you select on any page | `extension/` | Explain-on-select, right-click, shortcut; [install](extension/README.md) |

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
4. downloads the local model, **Qwen3.5 4B** (3.3 GB, runs on 8 GB of RAM);
5. installs [Open WebUI](https://openwebui.com), the chat portal on http://127.0.0.1:3000. If Docker is
   running it uses Open WebUI's Docker image (about 4 GB); otherwise it installs it into `.webui` (a few GB).

It also installs a **`neurochat` command**. From then on, open any terminal and type:

```bash
neurochat
```

Every run pulls the latest version from GitHub first (skipped when offline or if you've changed
files), then starts. Later runs start in seconds. Keep the window open while you use it: the portal at
http://127.0.0.1:8765 opens in your browser and only works while the companion is running.

- `--simulate` uses a fake headset; `--skip-model` skips Ollama and the model; `--no-update` skips the update;
  `--no-webui` skips Open WebUI. `NEUROCHAT_WEBUI=docker` or `NEUROCHAT_WEBUI=local` picks how Open WebUI runs.
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

Click **Find my headset**, and connect. Just want the chatbot? Click **go straight to the chat**: it opens
NeuroChat's own chat with the tutor. After a reply, **Continue in Open WebUI** moves the conversation there if you
want Open WebUI's history and search.
No headset with you? Click **Skip to eye tracking**: it
calibrates [WebEyeTrack](https://github.com/RedForestAI/WebEyeTrack) on your webcam (video never leaves the browser)
and shows how long you spend on each paragraph of a test passage. When a paragraph takes you much
longer than the rest, the tutor offers to explain it with the local model (streamed over
`/ws/chat`), and you can ask follow-up questions. **Continue in Open WebUI** copies the conversation into
Open WebUI to keep going there, with its chat history, search and model picker.

### Open WebUI

Open WebUI runs with sign-in turned off, because it only listens on this computer and is for one person.
The companion keeps a **NeuroChat Tutor** model in it (Qwen3.5 in Ollama plus the tutor's instructions).
It stops when you stop `neurochat`, and your chats are kept for next time (in the `neurochat-webui` Docker
volume, or in `.webui-data`). Already run your own Open WebUI on port 3000? NeuroChat uses that one instead,
as long as sign-in is off there; otherwise point it elsewhere with `NEUROCHAT_WEBUI_URL`.

With a real headset, close the Muse app first (the headset talks to one app at a time).
In **Chrome or Edge**, Find my headset connects it straight from the browser with
[Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth): pick your Muse in the list
the browser shows. The page forwards the raw Bluetooth packets to the companion, which decodes them
with [OpenMuse](https://github.com/DominiqueMakowski/OpenMuse)'s parser. This works on macOS, Windows
and ChromeOS, and also when the companion runs in Docker. On Linux, Chrome needs
`chrome://flags/#enable-experimental-web-platform-features` turned on.

In other browsers, or with **Search from the companion app**, the companion scans over Bluetooth LE
itself with [bleak](https://github.com/hbldh/bleak), starts OpenMuse to stream the headset onto Lab
Streaming Layer, and reads the EEG stream back with pylsl. On macOS, the terminal running it needs
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

- **Headset: use Chrome or Edge.** Docker can't reach Bluetooth, so the browser connects the
  Muse S Athena and passes its data to the container (see above). In other browsers the page offers a
  simulated headset instead.
- **Speed.** Ollama inside Docker can't use a Mac's GPU, so on a Mac it's slow. If the
  [Ollama app](https://ollama.com/download) is running on your computer and has the model (`ollama pull qwen3.5:4b`,
  or run `./start.sh` once), the container uses that one instead and answers come at full speed; the
  logs say which it picked. `-e NEUROCHAT_OLLAMA=bundled` or `=host` forces one. With an NVIDIA GPU on
  Linux or Windows, add `--gpus all` to use the one inside.
- Both ports listen on this computer only. The image is rebuilt and published from `main` by
  `.github/workflows/docker.yml`; `docker build --build-arg MODEL=qwen3.5:2b-q4_K_M .` bakes in another model.

## Engagement score → tutor prompt

`companion/engagement.py` is the NeuroChat kernel, computed the way the paper does (§3.2): 1–30 Hz
band-pass and 60 Hz notch, 1 s epochs every 250 ms, engagement = β / (α + θ) with θ 4–7, α 7–11 and
β 11–20 Hz, band powers averaged over a 15 s window that moves every second. Epochs with blinks or a
sensor off the skin are dropped. A calibration (2 min relaxing, 2 min word chain) gives E_min and
E_max, and the score is normalized to 0–1 against them. Without a calibration the score is relative
to the reading's own range.

The score falls in one of three bands, and each band adds its own instructions to Qwen's system prompt:

| Band | Score | What the tutor is told |
|---|---|---|
| Low | under 0.3 | Under 80 words, a small story or familiar example, one idea, end with a question that sparks curiosity |
| Moderate | 0.3 to 0.6 | Normal depth up to 120 words, main idea first, define jargon, check what's unclear |
| High | 0.6 and up | More technical, explain the mechanism, up to 180 words, connect to a related idea |

When you ask about a paragraph, the score is the one from while your eyes were on it; for an added
passage it's that passage's own; for a follow-up question it's the last 15 seconds, as in the paper.
The model is told never to mention or hint at the EEG, and the end-to-end check fails if a reply does. The plain simulated headset's EEG is noise and never
reaches the prompt.

```bash
python -m companion.engagement synth --out synthetic-eeg        # relax.csv, task.csv, reading.csv, labels.json
python -m companion.engagement score synthetic-eeg/reading.csv \
    --relax synthetic-eeg/relax.csv --task synthetic-eeg/task.csv  # per-second score and band
python -m companion --simulate --engagement demo                 # live: low, moderate, high every 60 s
python -m companion.e2e                                          # end-to-end check, about a minute
python -m companion.e2e --ollama http://127.0.0.1:11434          # same, with the real model answering
```

`python -m companion.realdata --out data/bird` downloads public Muse recordings (Bird et al. 2018: four
people, relaxed / neutral / concentrating) and scores them. Concentrating reads above neutral for three
of the four, and above it on held-out sessions; set `NEUROCHAT_BIRD_DATA=data/bird` to include that
check in `pytest`.

`score` reads a real recording too: Mind Monitor or muselsl CSVs (TP9, AF7, AF8, TP10 columns), NPZ,
or XDF (with `pip install pyxdf`). Live calibration is `POST /api/engagement/calibration/relax/start`,
then `/relax/finish`, the same for `task`; `PUT /api/engagement/calibration` sets E_min and E_max from
an offline one, and `GET /api/engagement` shows the score now.

## Tests

```bash
pytest
```

## Data

Recordings are biometric data. `data/` and `*.xdf` are ignored by git; never commit them.
