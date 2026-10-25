#!/usr/bin/env bash
# One-command start. On the first run it sets up a virtualenv, installs Ollama and downloads
# the local model; then it launches the companion app and opens the portal.
#   --simulate      try it without a headset
#   --skip-model    don't install Ollama or download the model
#   --no-update     don't pull the latest version first
# It also installs a `neurochat` command that runs this script from anywhere.
# NEUROCHAT_MODEL picks another Ollama model (default qwen3.5:4b, a 3.3 GB download).
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
args=()
for a in "$@"; do
  case "$a" in
    --skip-model) skip_model=1 ;;
    --no-update) ;;
    *) args+=("$a") ;;
  esac
done

# Python 3.11+: use one that's installed, otherwise let uv download one (no admin rights needed).
PY=""
for cand in python3.13 python3.12 python3.11 python3; do
  if command -v "$cand" >/dev/null && "$cand" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
    PY="$cand"; break
  fi
done
UV=""
if [ -z "$PY" ] && [ ! -d .venv ]; then
  UV="$(command -v uv || true)"
  [ -n "$UV" ] || [ ! -x "$HOME/.local/bin/uv" ] || UV="$HOME/.local/bin/uv"
  if [ -z "$UV" ]; then
    echo "No Python 3.11+ found; installing uv to fetch one…"
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh
    UV="$HOME/.local/bin/uv"
  fi
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
    Darwin|Linux) curl -fsSL https://ollama.com/install.sh | sh ;;
    *) echo "Install Ollama from https://ollama.com/download, then run neurochat again." >&2; return 1 ;;
  esac
}

# Several Ollamas can be installed (Homebrew, the Mac app, an old download). Use the newest.
pick_ollama() {
  local best="" bestv="" c v
  for c in $(type -ap ollama) /Applications/Ollama.app/Contents/Resources/ollama /usr/local/bin/ollama; do
    [ -x "$c" ] || continue
    v="$(ollama_version "$c")"; [ -n "$v" ] || continue
    if [ -z "$bestv" ] || older "$bestv" "$v"; then best="$c"; bestv="$v"; fi
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
    for _ in $(seq 1 40); do [ -n "$(server_version || true)" ] && break; sleep 0.5; done
  fi
  [ -n "$(server_version || true)" ] || { echo "Ollama didn't start." >&2; return 1; }
}

setup_model() {
  pick_ollama
  if ! command -v "$OLLAMA" >/dev/null; then install_ollama && pick_ollama || return 1; fi
  start_ollama || return 1
  if "$OLLAMA" list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$MODEL"; then
    echo "Local model ready: $MODEL"; return 0
  fi
  echo "Downloading $MODEL (one time only)…"
  local log; log="$(mktemp)"
  if ! "$OLLAMA" pull "$MODEL" 2>&1 | tee "$log"; then :; fi
  if grep -q "newer version of Ollama" "$log"; then
    # The model needs a newer Ollama than the one installed: update it and try once more.
    install_ollama && pick_ollama && start_ollama && "$OLLAMA" pull "$MODEL"
  fi
  rm -f "$log"
  if "$OLLAMA" list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$MODEL"; then
    echo "Local model ready: $MODEL"
  else
    echo "Couldn't download $MODEL. If it says Ollama is too old, update it from https://ollama.com/download and run neurochat again." >&2; return 1
  fi
}
if [ "$skip_model" = 0 ]; then
  setup_model || echo "Carrying on without the local model; the headset screens still work." >&2
fi
export NEUROCHAT_MODEL="$MODEL"

# `neurochat` command: a tiny launcher in ~/.local/bin that runs this script from anywhere.
install_command() {
  local bin="$HOME/.local/bin" launcher
  launcher="$(printf '#!/usr/bin/env bash\n# Installed by NeuroChat (%s). Updates and starts it.\nexec "%s" "$@"\n' "$REPO" "$SELF")"
  mkdir -p "$bin"
  if [ "$(cat "$bin/neurochat" 2>/dev/null)" != "$launcher" ]; then
    printf '%s\n' "$launcher" > "$bin/neurochat"
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
    printf '\n# NeuroChat: neurochat command\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
    echo "Added the neurochat command. Open a new terminal window, then just type: neurochat"
  fi
}
install_command || echo "Couldn't install the neurochat command; ./start.sh still works." >&2

url="http://127.0.0.1:8765"
opener=""
command -v open >/dev/null && opener=open
command -v xdg-open >/dev/null && opener=xdg-open
[ -n "$opener" ] && ( sleep 2; "$opener" "$url" ) >/dev/null 2>&1 &
echo "Opening $url (Ctrl+C to stop)"
exec python -m companion ${args[@]+"${args[@]}"}
