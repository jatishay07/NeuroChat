#!/usr/bin/env bash
# Checks the repo against its Google-style settings (docs/style.md) without
# changing anything. CI runs this; scripts/format.sh fixes most of what it finds.
set -euo pipefail
cd "$(dirname "$0")/.."

PRETTIER_VERSION="3.8.1"
SHELL_SCRIPTS=(start.sh docker/entrypoint.sh scripts/*.sh)
status=0

ruff check . || status=1
ruff format --check . || status=1
shfmt -i 2 -ci -bn -d "${SHELL_SCRIPTS[@]}" || status=1
shellcheck --severity=warning "${SHELL_SCRIPTS[@]}" || status=1
if command -v npx >/dev/null; then
  npx --yes "prettier@${PRETTIER_VERSION}" --check --log-level warn . || status=1
else
  echo "Skipped Prettier: install Node.js to check JavaScript, HTML and CSS." >&2
fi

if [ "$status" -ne 0 ]; then
  echo "Style check failed. Run scripts/format.sh, then fix what's left by hand." >&2
fi
exit "$status"
