# NeuroChat

A tutor that notices which part of a text you're struggling with and explains it again.
It extends [NeuroChat (arXiv 2503.07599)](https://arxiv.org/abs/2503.07599), which adapted a chatbot
to a single EEG engagement score, by adding eye tracking (which paragraph you're reading) and the
Muse S Athena's fNIRS (a second, slower sign of mental effort).

Everything runs on your own computer:

| Piece | Folder | Status |
|---|---|---|
| Companion app: headset connection, signals, detector, local LLM | `companion/` | Headset connection done |
| Portal: connect screen, then the chat | `portal/` | Connect screen done |
| Browser extension: paragraphs and webcam gaze on any page | `extension/` | Next |

Build plan: [Struggle-Aware Tutor Build Plan](https://claude.ai/artifact/B7heEKCnARoA9t1QNRfA4D).

## Run it

Needs Python 3.11+.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# No headset? Use the simulated one (add --bad-channel TP10 to see a failing sensor):
python -m companion --simulate

# With a Muse S Athena:
pip install -e ".[hardware]"
python -m companion
```

Then open http://127.0.0.1:8765, click **Find my headset**, and connect.

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
