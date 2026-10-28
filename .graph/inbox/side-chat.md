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
