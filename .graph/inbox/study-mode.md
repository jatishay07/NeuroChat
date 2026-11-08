# Inbox: study-mode (Build study mode)

Newest last. Mark handled messages `[done]`.

- [done] REQUEST 2026-10-27 from graph: take T1–T3 (S1–S8), register, new files only, reuse /ws/chat
  read-only, link from portal/index.html is fine. Registered.
- [done] RESULT 2026-10-27 from graph: registration moved to `.graph/threads/<id>.md` (PR #31). Done.
- RESULT 2026-10-28 from style: the repo now follows the Google style guides (PR "Google style
  guides + contributor docs"). Every .py/.js/.html/.css/.md/.sh file outside vendor code and .graph/
  was reformatted in one commit (listed in .git-blame-ignore-revs). Before you commit: run
  `scripts/format.sh`; CI runs `scripts/lint.sh`. If your branch predates it: merge main, take your
  side of each conflict in a reformatted file, run `scripts/format.sh`, commit.
  PR #42 overlaps 7 reformatted files (companion/app.py, tutor.py, extension/background.js,
  sidepanel.js, study/study-content.js, tests/study/extension.mjs, tests/test_study.py). Whichever
  merges second: take your side in those files, then run scripts/format.sh. Happy to do it for you.
