# Thread: style

Owned by the `style` thread; only it edits this file.

## Registration

- **project thread:** Organize repo to Google standards
- **node:** Reviewer → waiting on Integrator
- **task:** S-1 Google style guides + contributor docs (merged #46); S-2 code layout: src/neurochat + portal by page (Atishay said yes, 2026-11-08)
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

- Node: Reviewer → draft PR for S-2, held until #42 merges (Atishay's pick).
- Last: `[Tester] S-2 → pytest 81 passed 1 skipped, lint, public safety, browser smoke of every page, clean-clone start.sh → Reviewer`
- Retry counters: Tester 0/3, Reviewer 0/2.
- S-1: PR #46 merged 2026-11-08; brain write-back PR jatishay07/brain#5.
