#!/usr/bin/env bash
# One-command start: sets up a virtualenv on first run, then launches the companion app
# and opens the portal. Pass --simulate to try it without a headset.
set -euo pipefail
cd "$(dirname "$0")"

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
[[ " $* " == *" --simulate "* ]] || extras="dev,hardware"
stamp=".venv/.installed-$extras"
if [ ! -f "$stamp" ] || [ pyproject.toml -nt "$stamp" ]; then
  pip install --quiet --upgrade pip
  pip install --quiet -e ".[$extras]"
  touch "$stamp"
fi

url="http://127.0.0.1:8765"
opener=""
command -v open >/dev/null && opener=open
command -v xdg-open >/dev/null && opener=xdg-open
[ -n "$opener" ] && ( sleep 2; "$opener" "$url" ) >/dev/null 2>&1 &
echo "Opening $url (Ctrl+C to stop)"
exec python -m companion "$@"
