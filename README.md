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
4. downloads the local model, **Qwen3.5 4B** (3.3 GB, runs on 8 GB of RAM);
5. installs [Open WebUI](https://openwebui.com), the chat portal on http://127.0.0.1:3000. If Docker is
   running it uses Open WebUI's Docker image (about 4 GB); otherwise it installs it into `.webui` (about 2 GB).

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
a new chat with the **NeuroChat Tutor** in Open WebUI (or a simple chat page if Open WebUI isn't running).
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
The companion scans over Bluetooth LE with [bleak](https://github.com/hbldh/bleak), starts
[OpenMuse](https://github.com/DominiqueMakowski/OpenMuse) to stream the headset onto Lab Streaming
Layer, and reads the EEG stream back with pylsl. On macOS, the terminal running it needs
Bluetooth permission (System Settings → Privacy & Security → Bluetooth). On Linux, pylsl also
needs liblsl (`conda install -c conda-forge liblsl`, or the package from the
[liblsl releases](https://github.com/sccn/liblsl/releases)).

## Tests

```bash
pytest
```

## Data

Recordings are biometric data. `data/` and `*.xdf` are ignored by git; never commit them.
