# NeuroChat in one container: the companion app, Ollama with the Qwen model already downloaded,
# and Open WebUI. Nothing else to install:
#   docker run -p 127.0.0.1:8765:8765 -p 127.0.0.1:3000:3000 -v neurochat:/app/backend/data ghcr.io/jatishay07/neurochat
#
# Docker can't reach Bluetooth, so the browser connects the Muse S Athena (Web Bluetooth in
# Chrome or Edge) and forwards its packets to the companion. Otherwise it offers a simulated one.

# Open WebUI's own image with Ollama built in.
FROM ghcr.io/open-webui/open-webui:ollama

# Bake the model into the image (about 3.3 GB) so it works offline from the first start.
ARG MODEL=qwen3.5:4b
RUN ollama serve >/dev/null 2>&1 & \
    until ollama list >/dev/null 2>&1; do sleep 1; done; \
    ollama pull "$MODEL"

# The companion gets its own virtualenv so its packages can't clash with Open WebUI's.
WORKDIR /opt/neurochat
COPY pyproject.toml README.md ./
COPY companion ./companion
COPY portal ./portal
# Editable install: the app serves ../portal relative to its own source folder.
RUN python -m venv .venv && .venv/bin/pip install --no-cache-dir -e .
COPY docker/entrypoint.sh /usr/local/bin/neurochat-entrypoint
RUN chmod +x /usr/local/bin/neurochat-entrypoint

ENV NEUROCHAT_MODEL=$MODEL \
    NEUROCHAT_HOST=0.0.0.0 \
    NEUROCHAT_WEBUI_URL=http://127.0.0.1:3000 \
    # Open WebUI on port 3000 inside too, so the links the companion hands out work in the browser.
    PORT=3000 \
    # Sign-in off: the ports are published on this computer only and it's for one person.
    WEBUI_AUTH=False \
    ENABLE_OPENAI_API=False \
    DEFAULT_MODELS=neurochat-tutor \
    # Fewer background requests (follow-up suggestions, tags, autocomplete) keep a small model responsive.
    ENABLE_FOLLOW_UP_GENERATION=False \
    ENABLE_TAGS_GENERATION=False \
    ENABLE_AUTOCOMPLETE_GENERATION=False

WORKDIR /app/backend
EXPOSE 8765 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=2m \
  CMD curl -fs http://127.0.0.1:3000/health && curl -fs http://127.0.0.1:8765/api/device >/dev/null || exit 1
ENTRYPOINT ["neurochat-entrypoint"]
