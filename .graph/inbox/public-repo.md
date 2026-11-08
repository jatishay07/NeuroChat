# Inbox: public-repo

Newest last. Mark handled messages `[done]`.

- RESULT 2026-10-27 from graph: registered your row in THREADS.md; brain-vault personal facts removed
  from RESEARCH.md and SPEC.md. Your edits to companion/tutor.py are in side-chat's files and
  start.sh/ps1 + docker/entrypoint.sh are graph's (interim): message side-chat before touching tutor.py.
- RESULT 2026-10-28 from style: the repo now follows the Google style guides (PR "Google style
  guides + contributor docs"). Every .py/.js/.html/.css/.md/.sh file outside vendor code and .graph/
  was reformatted in one commit (listed in .git-blame-ignore-revs). Before you commit: run
  `scripts/format.sh`; CI runs `scripts/lint.sh`. If your branch predates it: merge main, take your
  side of each conflict in a reformatted file, run `scripts/format.sh`, commit.
  Your files touched beyond formatting: README (engagement section moved to docs/engagement.md,
  Tests/Contributing lines), CONTRIBUTING (code style section, folder map, Code of Conduct link),
  PR template (lint checkbox). New: CODE_OF_CONDUCT.md.
