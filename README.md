# NeuroChat

A tutor that notices which part of a text you're struggling with and explains it again.
It extends [NeuroChat (arXiv 2503.07599)](https://arxiv.org/abs/2503.07599), which adapted a chatbot
to a single EEG engagement score, by adding eye tracking (which paragraph you're reading) and the
Muse S Athena's fNIRS (a second, slower sign of mental effort).

Everything runs on your own computer:

| Piece                                                                           | Folder                 | Status                                                                   |
| ------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------ |
| Companion app: headset connection, signals, detector, local LLM                 | `companion/`           | Headset connection and tutor chat (Ollama) done                          |
| Portal: connect screen, eye tracking, then the chat                             | `portal/`              | Connect screen and eye-tracking test done                                |
| Chat portal: [Open WebUI](https://openwebui.com), for carrying on conversations | started by `neurochat` | Done                                                                     |
| Side chat: Chrome extension that explains what you select on any page           | `extension/`           | Explain-on-select, right-click, shortcut; [install](extension/README.md) |

No headset? Everything except the EEG works without one, and `--simulate` fakes it. The tutor runs on
**any model you like**: Qwen3.5 4B in Ollama by default, or your own (see [Use your own model](#use-your-own-model)).

> Research software, not a medical device. Nothing leaves your computer unless you point it at a
> remote model server yourself.

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
  `qwen3.5:9b` (6.6 GB) gives better answers on 16 GB machines. Any other model works too: see below.

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

### Use your own model

The tutor works with any chat model. Two environment variables pick it:

| Variable                | Default         | What                                                                                                           |
| ----------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `NEUROCHAT_MODEL`       | `qwen3.5:4b`    | The model's name, as your model server knows it                                                                |
| `NEUROCHAT_LLM_URL`     | (empty: Ollama) | An [OpenAI-compatible](https://platform.openai.com/docs/api-reference/chat) server's base URL, ending in `/v1` |
| `NEUROCHAT_LLM_API_KEY` | (none)          | Its API key, if it needs one                                                                                   |

**Any Ollama model** ([library](https://ollama.com/library)): `neurochat` downloads it on first run.

```bash
NEUROCHAT_MODEL=llama3.2:3b neurochat
NEUROCHAT_MODEL=gemma3:12b neurochat
```

**Any OpenAI-compatible server**: LM Studio, llama.cpp's `llama-server`, vLLM, Jan, LocalAI, or a hosted
API such as OpenAI or OpenRouter. Ollama isn't installed or started then.

```bash
# LM Studio (start its local server first)
NEUROCHAT_LLM_URL=http://127.0.0.1:1234/v1 NEUROCHAT_MODEL=qwen2.5-7b-instruct neurochat
# llama.cpp
NEUROCHAT_LLM_URL=http://127.0.0.1:8080/v1 NEUROCHAT_MODEL=local neurochat
# A hosted API (your text is then sent to that provider)
NEUROCHAT_LLM_URL=https://api.openai.com/v1 NEUROCHAT_MODEL=gpt-4o-mini NEUROCHAT_LLM_API_KEY=sk-... neurochat
```

On Windows PowerShell, set them first: `$env:NEUROCHAT_MODEL = "llama3.2:3b"; .\start.cmd`.
The tutor's status line on the portal says if the server can't be reached, refuses the key, or doesn't
have that model. Open WebUI is set up with the same server the first time it starts, so **Continue in Open WebUI**
uses it too; to switch servers later, change it in Open WebUI under Admin Settings → Connections.
Small models do best with the tutor's short prompts; anything 3B and up works, 7B+ explains better.

### Open WebUI

Open WebUI runs with sign-in turned off, because it only listens on this computer and is for one person.
The companion keeps a **NeuroChat Tutor** model in it (your model, Qwen3.5 by default, plus the tutor's instructions).
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
- **Your own model.** `-e NEUROCHAT_MODEL=llama3.2:3b` uses another Ollama model (downloaded on first
  start; add `-v neurochat-models:/root/.ollama` to keep it). For an OpenAI-compatible server add
  `-e NEUROCHAT_LLM_URL=... -e NEUROCHAT_MODEL=...` (and `-e NEUROCHAT_LLM_API_KEY=...`); a server on
  your own computer is `http://host.docker.internal:<port>/v1` from inside the container
  (on Linux also add `--add-host host.docker.internal:host-gateway`).
- Both ports listen on this computer only. The image is rebuilt and published from `main` by
  `.github/workflows/docker.yml`; `docker build --build-arg MODEL=qwen3.5:2b-q4_K_M .` bakes in another model.

## Engagement score → tutor prompt

With a headset, `companion/engagement.py` turns EEG into a 0–1 engagement score
the way the NeuroChat paper does, and the score's band (low, moderate, high)
changes how the tutor explains. The method, the bands, the command-line tools and
the calibration API are in [docs/engagement.md](docs/engagement.md).

## Tests

```bash
pytest               # unit tests, the end-to-end check and study mode's browser check
scripts/lint.sh      # style checks (Google style guides; see docs/style.md)
```

## Data

Recordings are biometric data. `data/`, `*.xdf`, `*.edf` and `*.bdf` are ignored by git, and CI rejects
them; never commit them. Public datasets are downloaded by scripts, not committed (see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Privacy and security

The companion and Open WebUI listen on 127.0.0.1 only, the webcam video stays in the browser, and the
companion refuses requests from other websites. Details, and how to report a problem privately, are in
[SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
[docs/style.md](docs/style.md) for code style. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

NeuroChat is under the [MIT License](LICENSE). It includes WebEyeTrack (MIT), MediaPipe (Apache 2.0) and
OpenMuse's parser (MIT), and the Docker image bundles Open WebUI, Ollama and the Qwen3.5 model under their
own licenses: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Based on _NeuroChat: A Neuroadaptive AI Chatbot for Customizing Learning Experiences_
([arXiv 2503.07599](https://arxiv.org/abs/2503.07599)). The eye tracker is
[WebEyeTrack](https://arxiv.org/abs/2508.19544) by Davalos et al.
