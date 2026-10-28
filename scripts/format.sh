#!/usr/bin/env bash
# Formats the whole repo to its Google-style settings (docs/style.md):
# Python with Ruff, JavaScript/HTML/CSS/JSON/YAML/Markdown with Prettier, shell
# scripts with shfmt. Install the tools with: pip install -e ".[dev]" (Prettier
# runs through npx, so it needs Node.js).
set -euo pipefail
cd "$(dirname "$0")/.."

PRETTIER_VERSION="3.8.1"
SHELL_SCRIPTS=(start.sh docker/entrypoint.sh scripts/*.sh)

ruff check --fix --quiet .
ruff format --quiet .
shfmt -i 2 -ci -bn -w "${SHELL_SCRIPTS[@]}"
if command -v npx >/dev/null; then
  npx --yes "prettier@${PRETTIER_VERSION}" --write --log-level warn .
else
  echo "Skipped Prettier: install Node.js to format JavaScript, HTML and CSS." >&2
fi
