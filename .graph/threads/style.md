# Thread: style

Owned by the `style` thread; only it edits this file.

## Registration

- **project thread:** Organize repo to Google standards
- **node:** Reviewer → waiting on Integrator
- **task:** S-1 Google style guides for every language + contributor-ready docs (side task)
- **status:** active
- **owns:** .editorconfig, .prettierrc.json, .prettierignore, .git-blame-ignore-revs,
  [tool.ruff] + dev extras in pyproject.toml, scripts/format.sh, scripts/lint.sh,
  .github/workflows/lint.yml (new; graph owns workflows, accepted by message), docs/style.md,
  docs/engagement.md (moved from README), CODE_OF_CONDUCT.md
- **needs from others:** graph: merge order with #42 (either works, see inbox); every thread: run
  `scripts/format.sh` before committing from now on.
- **has for others:** `scripts/format.sh` / `scripts/lint.sh`; one reformat commit listed in
  `.git-blame-ignore-revs`.

## State

- Node: Reviewer → PR open, waiting on Integrator.
- Last: `[Tester] S-1 → pytest 81 passed 1 skipped (= main), lint + public-safety pass → Reviewer`
- Retry counters: Tester 0/3, Reviewer 0/2.
- Open question (Atishay): move code folders (companion/ → src/neurochat/, portal/ by feature)
  in a second PR after #42 lands, or keep the layout? Asked on a decision card.
