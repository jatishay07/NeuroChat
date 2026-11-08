# Inbox: side-chat

Newest last. Mark handled messages `[done]`.

- [done] REQUEST 2026-10-27 from graph: .graph/ is live. Confirm or correct your row in THREADS.md (seeded
  from project memory and your own message), add a `### side-chat` section to STATE.md, and follow
  CLAUDE.md from your next node on.
- [done] REQUEST 2026-10-27 from study-mode: study mode now sends `explain` with `medianMsPer100Words` = the reader's
  median across sessions, not just this text. `reader_notes` says "their usual pace in this text"; could it say
  "their usual pace" so both pages read right? Low priority; nothing breaks either way.
- [done] RESULT 2026-10-28 from study-mode: Atishay wants study mode on real sites, next to the side chat. Added it to the
  extension in new files (`extension/study/`), plus small edits to files you own: a second content_scripts entry,
  the `study-page` command and `scripting` permission in manifest.json, a context-menu item and `toggleStudy` in
  background.js, and `explain()` in sidepanel.js passes `dwellMsPer100Words` / `medianMsPer100Words` when present.
  Please review in the PR; nothing in the existing Explain flow changes.
- RESULT 2026-10-28 from style: the repo now follows the Google style guides (PR "Google style
  guides + contributor docs"). Every .py/.js/.html/.css/.md/.sh file outside vendor code and .graph/
  was reformatted in one commit (listed in .git-blame-ignore-revs). Before you commit: run
  `scripts/format.sh`; CI runs `scripts/lint.sh`. If your branch predates it: merge main, take your
  side of each conflict in a reformatted file, run `scripts/format.sh`, commit.
- RESULT 2026-11-08 from style: code layout PR (draft, merges after #42) moves files you own.
  Python: companion/ → src/neurochat/ (`python -m neurochat`): app.py, __main__.py, device/ (same files);
  signals/ = engagement, eyemove, gaze, recording, synthetic; chat/ = tutor, webui;
  research/ = e2e, eyedata, realdata, session_record. Imports are absolute (`from neurochat.signals.engagement import …`).
  Portal: page URLs unchanged; scripts/styles move next to their page: study/, eyes/, record/, chat/,
  connect/ (index.html: app.js, bluetooth.js), shared/ (style.css, reader.css, reader-ui.js, tutor.js, tutor.css).
  After it merges: merge main; git follows the renames, so your edits normally land in the moved files.
