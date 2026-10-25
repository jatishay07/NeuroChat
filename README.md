# NeuroChat

A tutor that notices which part of a text you're struggling with and explains it again.
It extends [NeuroChat (arXiv 2503.07599)](https://arxiv.org/abs/2503.07599), which adapted a chatbot
to a single EEG engagement score, by adding eye tracking (which paragraph you're reading) and the
Muse S Athena's fNIRS (a second, slower sign of mental effort).

Everything runs on your own computer:

| Piece | Folder | Status |
|---|---|---|
| Companion app: headset connection, signals, detector, local LLM | `companion/` | Headset connection done; model downloads with `start.sh`, chat not wired yet |
| Portal: connect screen, then the chat | `portal/` | Connect screen done |
| Browser extension: paragraphs and webcam gaze on any page | `extension/` | Next |

Build plan: [Struggle-Aware Tutor Build Plan](https://claude.ai/artifact/B7heEKCnARoA9t1QNRfA4D).

## Run it

Needs Python 3.11+ (on a Mac: `brew install python@3.12`).

```bash
git clone https://github.com/jatishay07/NeuroChat.git
cd NeuroChat

./start.sh --simulate   # no headset: a simulated one (add --bad-channel TP10 to see a failing sensor)
./start.sh              # with a Muse S Athena
```

The first run sets up a virtualenv in `.venv`, installs [Ollama](https://ollama.com) (with Homebrew
on a Mac) and downloads the local model, **Qwen3.5 4B** (a 3.3 GB download, runs on 8 GB of RAM).
Later runs start straight away. The portal opens in your browser at http://127.0.0.1:8765.

- `./start.sh --skip-model` skips Ollama and the model download.
- `NEUROCHAT_MODEL=qwen3.5:2b-q4_K_M ./start.sh` uses a smaller model (1.9 GB) on older machines;
  `qwen3.5:9b` (6.6 GB) gives better answers on 16 GB machines.

<details>
<summary>Manual setup instead</summary>

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"            # add ,hardware for a real headset: ".[dev,hardware]"
python -m companion --simulate     # or: python -m companion
```
</details>

Click **Find my headset**, and connect.

With a real headset, close the Muse app first (the headset talks to one app at a time).
The companion scans over Bluetooth LE with [bleak](https://github.com/hbldh/bleak), starts
[OpenMuse](https://github.com/DominiqueMakowski/OpenMuse) to stream the headset onto Lab Streaming
Layer, and reads the EEG stream back with pylsl. On macOS, the terminal running it needs
Bluetooth permission (System Settings → Privacy & Security → Bluetooth).

## Tests

```bash
pytest
```

## Data

Recordings are biometric data. `data/` and `*.xdf` are ignored by git; never commit them.
