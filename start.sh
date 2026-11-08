#!/usr/bin/env bash
# One-command start. On the first run it sets up a virtualenv, installs Ollama and downloads
# the local model; then it launches the companion app and opens the portal.
#   --simulate      try it without a headset
#   --skip-model    don't install Ollama or download the model
#   --no-update     don't pull the latest version first
#   --no-webui      don't start Open WebUI (the full chat portal on http://127.0.0.1:3000)
# It also installs a `neurochat` command that runs this script from anywhere.
# NEUROCHAT_MODEL picks another model (default qwen3.5:4b in Ollama, a 3.3 GB download).
# NEUROCHAT_LLM_URL uses an OpenAI-compatible server instead of Ollama (e.g. http://127.0.0.1:1234/v1
# for LM Studio), with NEUROCHAT_LLM_API_KEY if it needs one; Ollama isn't installed then.
# NEUROCHAT_WEBUI=docker|local|off picks how Open WebUI runs (default: Docker when it's running).
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(pwd)"
SELF="$REPO/$(basename "$0")"

# Update to the latest version on every run, then restart with the new script. Skipped when
# offline, when you have local changes, or when you're on a branch other than main.
if [ -z "${NEUROCHAT_UPDATED:-}" ] && [[ " $* " != *" --no-update "* ]] && [ -d .git ] && command -v git >/dev/null; then
  if [ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = main ] && git diff --quiet HEAD 2>/dev/null; then
    before="$(git rev-parse HEAD)"
    if GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=10 pull --quiet --ff-only origin main 2>/dev/null; then
      [ "$(git rev-parse HEAD)" = "$before" ] || echo "Updated NeuroChat to the latest version."
    else
      echo "Couldn't check for updates (offline?); starting the version you have."
    fi
  fi
  NEUROCHAT_UPDATED=1 exec "$SELF" "$@"
fi

MODEL="${NEUROCHAT_MODEL:-qwen3.5:4b}"
skip_model=0
WEBUI_MODE="${NEUROCHAT_WEBUI:-auto}"
args=()
for a in "$@"; do
  case "$a" in
    --skip-model) skip_model=1 ;;
    --no-webui) WEBUI_MODE=off ;;
    --no-update) ;;
    *) args+=("$a") ;;
  esac
done

# Python 3.11+: use one that's installed, otherwise let uv download one (no admin rights needed).
PY=""
for cand in python3.13 python3.12 python3.11 python3; do
  if command -v "$cand" >/dev/null && "$cand" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
    PY="$cand"
    break
  fi
done
UV=""
find_uv() {
  [ -z "$UV" ] || return 0
  UV="$(command -v uv || true)"
  [ -n "$UV" ] || [ ! -x "$HOME/.local/bin/uv" ] || UV="$HOME/.local/bin/uv"
  if [ -z "$UV" ]; then
    echo "Installing uv (fetches the right Python, no admin rights needed)…"
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh
    UV="$HOME/.local/bin/uv"
  fi
}
if [ -z "$PY" ] && [ ! -d .venv ]; then
  echo "No Python 3.11+ found."
  find_uv
fi

if [ ! -d .venv ]; then
  echo "First run: setting up (this takes a minute)…"
  if [ -n "$PY" ]; then "$PY" -m venv .venv; else "$UV" venv --quiet --seed --python 3.12 .venv; fi
fi
source .venv/bin/activate

extras="dev"
[[ " ${args[*]-} " == *" --simulate "* ]] || extras="dev,hardware"
stamp=".venv/.installed-$extras"
if [ ! -f "$stamp" ] || [ pyproject.toml -nt "$stamp" ]; then
  pip install --quiet --upgrade pip
  if pip install --quiet -e ".[$extras]"; then
    touch "$stamp"
  else
    # Bluetooth/LSL packages can fail on some machines; still start so eye tracking works.
    pip install --quiet -e ".[dev]"
    echo "Headset support didn't install, so connecting a headset won't work yet; eye tracking still does." >&2
  fi
fi

# Local model: install Ollama if it's missing, make sure it's running, download the model once.
OLLAMA=ollama
ollama_version() { "$1" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tail -1; }
server_version() { curl -fsS --max-time 2 http://127.0.0.1:11434/api/version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'; }
older() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]; }

install_ollama() {
  echo "Installing the latest Ollama (runs the local model; may ask for your password)…"
  case "$(uname)" in
    Darwin | Linux) curl -fsSL https://ollama.com/install.sh | sh ;;
    *)
      echo "Install Ollama from https://ollama.com/download, then run neurochat again." >&2
      return 1
      ;;
  esac
}

# Several Ollamas can be installed (Homebrew, the Mac app, an old download). Use the newest.
pick_ollama() {
  local best="" bestv="" c v
  for c in $(type -ap ollama) /Applications/Ollama.app/Contents/Resources/ollama /usr/local/bin/ollama; do
    [ -x "$c" ] || continue
    v="$(ollama_version "$c")"
    [ -n "$v" ] || continue
    if [ -z "$bestv" ] || older "$bestv" "$v"; then
      best="$c"
      bestv="$v"
    fi
  done
  [ -n "$best" ] && OLLAMA="$best"
}

# Make sure the Ollama server that's running is the newest one we have, and start it if needed.
start_ollama() {
  local want have
  want="$(ollama_version "$OLLAMA")"
  have="$(server_version || true)"
  if [ -n "$have" ] && older "$have" "$want"; then
    echo "Restarting Ollama ($have is running, $want is installed)…"
    [ "$(uname)" = "Darwin" ] && osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
    command -v brew >/dev/null && brew services stop ollama >/dev/null 2>&1 || true
    pkill -f "ollama serve" >/dev/null 2>&1 || true
    sleep 2
    have=""
  fi
  if [ -z "$(server_version || true)" ]; then
    if [ "$(uname)" = "Darwin" ] && [ -d /Applications/Ollama.app ] && [[ "$OLLAMA" == /Applications/* || "$OLLAMA" == /usr/local/bin/* ]]; then
      open -g -a Ollama
    else
      "$OLLAMA" serve >/dev/null 2>&1 &
    fi
    for _ in $(seq 1 40); do
      [ -n "$(server_version || true)" ] && break
      sleep 0.5
    done
  fi
  [ -n "$(server_version || true)" ] || {
    echo "Ollama didn't start." >&2
    return 1
  }
}

setup_model() {
  pick_ollama
  if ! command -v "$OLLAMA" >/dev/null; then install_ollama && pick_ollama || return 1; fi
  start_ollama || return 1
  if "$OLLAMA" list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$MODEL"; then
    echo "Local model ready: $MODEL"
    return 0
  fi
  echo "Downloading $MODEL (one time only)…"
  local log
  log="$(mktemp)"
  if ! "$OLLAMA" pull "$MODEL" 2>&1 | tee "$log"; then :; fi
  if grep -q "newer version of Ollama" "$log"; then
    # The model needs a newer Ollama than the one installed: update it and try once more.
    install_ollama && pick_ollama && start_ollama && "$OLLAMA" pull "$MODEL"
  fi
  rm -f "$log"
  if "$OLLAMA" list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$MODEL"; then
    echo "Local model ready: $MODEL"
  else
    echo "Couldn't download $MODEL. If it says Ollama is too old, update it from https://ollama.com/download and run neurochat again." >&2
    return 1
  fi
}
if [ -n "${NEUROCHAT_LLM_URL:-}" ]; then
  echo "Using $MODEL from $NEUROCHAT_LLM_URL (NEUROCHAT_LLM_URL), so not setting up Ollama."
elif [ "$skip_model" = 0 ]; then
  setup_model || echo "Carrying on without the local model; the headset screens still work." >&2
fi
export NEUROCHAT_MODEL="$MODEL"

# `neurochat` command: a tiny launcher in ~/.local/bin that runs this script from anywhere.
install_command() {
  local bin="$HOME/.local/bin" launcher
  launcher="$(printf '#!/usr/bin/env bash\n# Installed by NeuroChat (%s). Updates and starts it.\nexec "%s" "$@"\n' "$REPO" "$SELF")"
  mkdir -p "$bin"
  if [ "$(cat "$bin/neurochat" 2>/dev/null)" != "$launcher" ]; then
    printf '%s\n' "$launcher" >"$bin/neurochat"
    chmod +x "$bin/neurochat"
  fi
  case ":$PATH:" in *":$bin:"*) return ;; esac
  local rc
  case "${SHELL:-}" in
    */zsh) rc="$HOME/.zshrc" ;;
    */bash) if [ "$(uname)" = "Darwin" ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    *) rc="$HOME/.profile" ;;
  esac
  if ! grep -qs 'NeuroChat: neurochat command' "$rc"; then
    printf '\n# NeuroChat: neurochat command\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc"
    echo "Added the neurochat command. Open a new terminal window, then just type: neurochat"
  fi
}
install_command || echo "Couldn't install the neurochat command; ./start.sh still works." >&2

# Port 8765 taken? Usually it's the NeuroChat Docker container (it restarts itself), or another
# neurochat window. Say which, instead of failing to start.
if ! python -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 8765))' 2>/dev/null; then
  box=""
  if command -v docker >/dev/null; then box="$(docker ps --filter publish=8765 --format '{{.Names}}' 2>/dev/null | head -1 || true)"; fi
  if [ -n "$box" ]; then
    echo "The NeuroChat Docker container ($box) is already running on http://127.0.0.1:8765." >&2
    echo "Use that, or stop it first to run NeuroChat here:  docker stop $box" >&2
  else
    echo "Something is already using port 8765, probably NeuroChat in another window." >&2
    echo "Open http://127.0.0.1:8765, or close the other one first." >&2
  fi
  exit 1
fi

# Open WebUI: the full chat portal, where tutor conversations carry on ("Continue in Open WebUI").
# It runs in Docker when Docker is running, otherwise in its own Python environment in .webui.
# Sign-in is off: it only listens on this computer and is for one person.
WEBUI_PORT=3000
WEBUI_PID=""
WEBUI_CONTAINER=""
# Fewer background requests (follow-up suggestions, tags, autocomplete) keep a small model responsive.
webui_vars=(WEBUI_AUTH=False DEFAULT_MODELS=neurochat-tutor ENABLE_FOLLOW_UP_GENERATION=False
  ENABLE_TAGS_GENERATION=False ENABLE_AUTOCOMPLETE_GENERATION=False)
# Your own OpenAI-compatible server shows up in Open WebUI too. Open WebUI keeps the connection it
# was first set up with; change it later in its Admin Settings > Connections.
if [ -n "${NEUROCHAT_LLM_URL:-}" ]; then
  webui_vars+=(ENABLE_OPENAI_API=True "OPENAI_API_BASE_URL=$NEUROCHAT_LLM_URL" "OPENAI_API_KEY=${NEUROCHAT_LLM_API_KEY:-none}")
else
  webui_vars+=(ENABLE_OPENAI_API=False)
fi
start_webui_docker() {
  command -v docker >/dev/null && docker info >/dev/null 2>&1 || {
    echo "Docker isn't running." >&2
    return 1
  }
  if docker container inspect neurochat-webui >/dev/null 2>&1; then
    docker start neurochat-webui >/dev/null || return 1
  else
    echo "Starting Open WebUI in Docker (the first time downloads about 4 GB)…"
    local net env=() v
    for v in "${webui_vars[@]}"; do env+=(-e "$v"); done
    if [ "$(uname)" = Linux ]; then
      # Ollama only listens on 127.0.0.1, which a container can reach only on the host's network.
      net=(--network host -e "PORT=$WEBUI_PORT" -e HOST=127.0.0.1 -e OLLAMA_BASE_URL=http://127.0.0.1:11434)
    else
      net=(-p "127.0.0.1:$WEBUI_PORT:8080" -e OLLAMA_BASE_URL=http://host.docker.internal:11434)
      # Inside the container, this computer is host.docker.internal.
      for v in "${!env[@]}"; do
        case "${env[$v]}" in OPENAI_API_BASE_URL=*)
          env[$v]="$(printf '%s' "${env[$v]}" | sed -E 's#//(127\.0\.0\.1|localhost)([:/]|$)#//host.docker.internal\2#')"
          ;;
        esac
      done
    fi
    docker run -d --name neurochat-webui -v neurochat-webui:/app/backend/data "${net[@]}" "${env[@]}" \
      ghcr.io/open-webui/open-webui:main >/dev/null || return 1
  fi
  WEBUI_CONTAINER=neurochat-webui
}
start_webui_local() {
  local venv="$REPO/.webui"
  if [ ! -x "$venv/bin/open-webui" ]; then
    echo "Installing Open WebUI (one time only, a few GB; takes several minutes)…"
    find_uv
    "$UV" venv --quiet --python 3.11 "$venv" && "$UV" pip install --quiet --python "$venv/bin/python" open-webui || return 1
  fi
  mkdir -p "$REPO/.webui-data"
  # Run it from its data folder: it keeps its secret key (.webui_secret_key) in the current folder.
  (cd "$REPO/.webui-data" && exec env DATA_DIR="$REPO/.webui-data" "${webui_vars[@]}" OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    "$venv/bin/open-webui" serve --host 127.0.0.1 --port "$WEBUI_PORT" >open-webui.log 2>&1) &
  WEBUI_PID=$!
}
stop_webui() {
  [ -z "$WEBUI_PID" ] || kill "$WEBUI_PID" 2>/dev/null || true
  [ -z "$WEBUI_CONTAINER" ] || docker stop "$WEBUI_CONTAINER" >/dev/null 2>&1 || true
}
start_webui() {
  case "$WEBUI_MODE" in
    docker) start_webui_docker ;;
    local) start_webui_local ;;
    # Keep using whichever it was set up with before, so earlier chats are still there.
    *) if [ ! -d "$REPO/.webui" ] && command -v docker >/dev/null && docker info >/dev/null 2>&1; then
      start_webui_docker || start_webui_local
    else
      start_webui_local
    fi ;;
  esac
}
if curl -fsS --max-time 2 "http://127.0.0.1:$WEBUI_PORT/health" >/dev/null 2>&1; then
  echo "Open WebUI is already running on http://127.0.0.1:$WEBUI_PORT"
elif [ "$WEBUI_MODE" != off ]; then
  if start_webui; then
    echo "Open WebUI is starting on http://127.0.0.1:$WEBUI_PORT (it takes up to a minute)."
  else
    echo "Open WebUI didn't start, so chats stay in the NeuroChat page." >&2
  fi
fi
trap stop_webui EXIT

url="http://127.0.0.1:8765"
opener=""
command -v open >/dev/null && opener=open
command -v xdg-open >/dev/null && opener=xdg-open
[ -n "$opener" ] && (
  sleep 2
  "$opener" "$url"
) >/dev/null 2>&1 &
echo "Opening $url (Ctrl+C to stop)"
python -m companion ${args[@]+"${args[@]}"} || true
