#!/bin/bash
# Runs the companion next to Open WebUI. Open WebUI's start.sh also starts Ollama (USE_OLLAMA_DOCKER).
# Extra arguments go to the companion, e.g. --bad-channel TP10.
set -e
(
  cd /opt/neurochat
  while true; do  # restart the companion if it ever exits
    .venv/bin/python -m companion --simulate "$@" || true
    sleep 2
  done
) &
cd /app/backend
exec bash start.sh
