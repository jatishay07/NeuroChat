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

PY=""
for cand in python3.13 python3.12 python3.11 python3; do
  if command -v "$cand" >/dev/null && "$cand" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then
    PY="$cand"; break
  fi
done
if [ -z "$PY" ]; then
  echo "NeuroChat needs Python 3.11 or newer. On a Mac: brew install python@3.12" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "First run: setting up (this takes a minute)…"
  "$PY" -m venv .venv
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
setup_model() {
  if ! command -v ollama >/dev/null; then
    echo "Installing Ollama (runs the local model)…"
    if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null; then
      brew install ollama
    elif [ "$(uname)" = "Linux" ]; then
      curl -fsSL https://ollama.com/install.sh | sh
    else
      echo "Install Ollama from https://ollama.com/download, then run ./start.sh again." >&2
      return 1
    fi
  fi
  if ! ollama list >/dev/null 2>&1; then
    ollama serve >/dev/null 2>&1 &
    for _ in $(seq 1 30); do ollama list >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  if ! ollama list 2>/dev/null | awk 'NR > 1 {print $1}' | grep -qx "$MODEL"; then
    echo "Downloading $MODEL (one time only)…"
    ollama pull "$MODEL"
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
