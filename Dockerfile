# NeuroChat companion app (portal, tutor chat, simulated headset).
# The real Muse S Athena needs Bluetooth, which Docker on macOS and Windows can't reach,
# so the container runs the simulated headset. Run ./start.sh natively for the real one.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NEUROCHAT_HOST=0.0.0.0

WORKDIR /app
COPY pyproject.toml README.md ./
COPY companion ./companion
COPY portal ./portal
# Editable install: the app serves ../portal relative to its own source folder.
RUN pip install -e . && useradd --create-home neurochat
USER neurochat

EXPOSE 8765
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/device')"
CMD ["python", "-m", "companion", "--simulate"]
