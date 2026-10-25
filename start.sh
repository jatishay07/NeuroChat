#!/usr/bin/env bash
# One-command start. On the first run it sets up a virtualenv, installs Ollama and downloads
# the local model; then it launches the companion app and opens the portal.
#   --simulate      try it without a headset
#   --skip-model    don't install Ollama or download the model
# NEUROCHAT_MODEL picks another Ollama model (default qwen3.5:4b, a 3.3 GB download).
set -euo pipefail
cd "$(dirname "$0")"

MODEL="${NEUROCHAT_MODEL:-qwen3.5:4b}"
skip_model=0
args=()
for a in "$@"; do
  if [ "$a" = "--skip-model" ]; then skip_model=1; else args+=("$a"); fi
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
  pip install --quiet -e ".[$extras]"
  touch "$stamp"
fi

# Local model: install Ollama if it's missing, make sure it's running, download the model once.
OLLAMA=ollama
setup_model() {
  if ! command -v ollama >/dev/null; then
    local app_cli=/Applications/Ollama.app/Contents/Resources/ollama
    if [ "$(uname)" = "Darwin" ]; then
      # Ollama's install.sh is Linux-only; on a Mac install the app (which carries the CLI).
      if [ ! -x "$app_cli" ]; then
        echo "Installing Ollama (runs the local model)…"
        local tmp; tmp="$(mktemp -d)"
        curl -fsSL -o "$tmp/Ollama.zip" https://ollama.com/download/Ollama-darwin.zip
        ditto -x -k "$tmp/Ollama.zip" /Applications
        rm -rf "$tmp"
      fi
      [ -x "$app_cli" ] || { echo "Ollama didn't install. Get it from https://ollama.com/download" >&2; return 1; }
      OLLAMA="$app_cli"
      open -g -a Ollama  # the app runs the Ollama server in the background
    elif [ "$(uname)" = "Linux" ]; then
      echo "Installing Ollama (runs the local model)…"
      curl -fsSL https://ollama.com/install.sh | sh
    else
      echo "Install Ollama from https://ollama.com/download, then run ./start.sh again." >&2
      return 1
    fi
  fi
  if ! "$OLLAMA" list >/dev/null 2>&1; then
    "$OLLAMA" serve >/dev/null 2>&1 &
    for _ in $(seq 1 30); do "$OLLAMA" list >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  if ! "$OLLAMA" list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$MODEL"; then
    echo "Downloading $MODEL (one time only)…"
    "$OLLAMA" pull "$MODEL"
  fi
  echo "Local model ready: $MODEL"
}
if [ "$skip_model" = 0 ]; then
  setup_model || echo "Carrying on without the local model; the headset screens still work." >&2
fi
export NEUROCHAT_MODEL="$MODEL"

url="http://127.0.0.1:8765"
opener=""
command -v open >/dev/null && opener=open
command -v xdg-open >/dev/null && opener=xdg-open
[ -n "$opener" ] && ( sleep 2; "$opener" "$url" ) >/dev/null 2>&1 &
echo "Opening $url (Ctrl+C to stop)"
exec python -m companion ${args[@]+"${args[@]}"}
