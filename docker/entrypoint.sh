#!/bin/bash
# Runs the companion next to Open WebUI. Open WebUI's start.sh also starts Ollama (USE_OLLAMA_DOCKER).
# Extra arguments go to the companion, e.g. --bad-channel TP10.
#
# NEUROCHAT_OLLAMA picks which Ollama answers:
#   auto (default)  the Ollama on this computer if it's running and has the model, else the one inside.
#                   On a Mac that's much faster: Docker can't use the GPU, the Ollama app can.
#   host            always the one on this computer.   bundled   always the one inside.
# NEUROCHAT_MODEL picks another model; the bundled Ollama downloads it on first start if it's missing.
# NEUROCHAT_LLM_URL uses an OpenAI-compatible server instead (NEUROCHAT_LLM_API_KEY if it needs a key).
set -e
HOST_OLLAMA="${NEUROCHAT_HOST_OLLAMA:-http://host.docker.internal:11434}"
mode="${NEUROCHAT_OLLAMA:-auto}"
use_host=false
if [ "$mode" = host ]; then
  use_host=true
elif [ "$mode" = auto ] && curl -fs --max-time 2 "$HOST_OLLAMA/api/tags" | grep -q "\"$NEUROCHAT_MODEL\""; then
  use_host=true
fi
if [ -n "${NEUROCHAT_LLM_URL:-}" ]; then
  echo "Using $NEUROCHAT_MODEL from $NEUROCHAT_LLM_URL."
  export ENABLE_OPENAI_API=True OPENAI_API_BASE_URL="$NEUROCHAT_LLM_URL" OPENAI_API_KEY="${NEUROCHAT_LLM_API_KEY:-none}"
elif $use_host; then
  echo "Using the Ollama on this computer ($HOST_OLLAMA)."
  export USE_OLLAMA_DOCKER=false OLLAMA_BASE_URL="$HOST_OLLAMA" OLLAMA_HOST="$HOST_OLLAMA"
else
  echo "Using the Ollama inside this container."
  # A model other than the one baked in: download it once Ollama is up (kept in the data volume
  # only if you mount one at /root/.ollama).
  (
    until ollama list >/dev/null 2>&1; do sleep 2; done
    ollama list | awk 'NR > 1 {print $1}' | grep -qx "$NEUROCHAT_MODEL" || ollama pull "$NEUROCHAT_MODEL"
  ) &
fi

(
  cd /opt/neurochat
  while true; do  # restart the companion if it ever exits
    .venv/bin/python -m companion --simulate "$@" || true
    sleep 2
  done
) &
cd /app/backend
exec bash start.sh
