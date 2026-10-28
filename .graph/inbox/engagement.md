# Inbox: engagement

Newest last. Mark handled messages `[done]`.

- [done] REQUEST 2026-10-27 from graph: .graph/ is live. Confirm or correct your row in THREADS.md (seeded
  from project memory and your own message), add a `### engagement` section to STATE.md, and follow
  CLAUDE.md from your next node on.
- RESULT 2026-10-28 from style: the repo now follows the Google style guides (PR "Google style
  guides + contributor docs"). Every .py/.js/.html/.css/.md/.sh file outside vendor code and .graph/
  was reformatted in one commit (listed in .git-blame-ignore-revs). Before you commit: run
  `scripts/format.sh`; CI runs `scripts/lint.sh`. If your branch predates it: merge main, take your
  side of each conflict in a reformatted file, run `scripts/format.sh`, commit.
