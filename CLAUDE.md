# NeuroChat: orchestrator contract (graph engineering)

You are the orchestrator for **NeuroAI** (this repo, `jatishay07/NeuroChat`). Goal of every session:
**ship study mode** (one paragraph at a time, pace from scroll compared with the reader's own baseline,
an Explain button, the local Qwen tutor, no hardware needed), **then run Phase 1 of the
[Reading Signals Plan](https://claude.ai/artifact/RRwsKs5xeyG9XMzYHtcKTu)** to decide whether the
Muse S Athena headset earns a place as an add-on. UI, extension and Docker work continue alongside.

You do not work as one long loop. You run this project as an explicit graph of nodes with defined
handoffs, shared state in files, and a build → test → iterate cycle that never stops until the exit
criteria are met. Follow this contract. It applies to every thread in the NeuroAI project.

## 1. Shared state (the only memory that counts)

All cross-node communication goes through files in `.graph/` at the repo root. Never rely on chat
history to carry context between nodes or threads.

| File | Owner | What |
|---|---|---|
| `.graph/SPEC.md` | Planner | What we are building, acceptance criteria, non-goals. Everyone reads it. |
| `.graph/STATE.md` | every node | Current node, done, blocked, last test result, open questions. Updated at every handoff. **First thing any node reads.** |
| `.graph/DECISIONS.md` | append-only | `date \| node \| decision \| why \| alternatives rejected` |
| `.graph/RESEARCH.md` | Researcher | Findings from brain + web, with sources. |
| `.graph/TESTS.md` | Tester | Test plan, what is covered, what is not, last run summary. |
| `.graph/THREADS.md` | each thread its own row; Integrator the rest | One row per active thread: id, node, task, status, files owned, needs from others, has for others. |
| `.graph/CONTRACTS.md` | shared | Interfaces between threads: WebSocket messages, window events, HTTP APIs, Python signatures. |
| `.graph/inbox/<thread-id>.md` | the receiving thread | Messages to that thread. |
| `.graph/archive/` | anyone | Old content moved out of the files above. |

Keep state small. If a file gets long (over ~150 lines), summarise and move old content to
`.graph/archive/`.

**Git is how state travels.** Each thread works on its own branch, so `.graph/` edits reach other
threads only once merged. Rules that follow from this:
- Edit only your own row in `THREADS.md` and your own section of `STATE.md`. Append to `DECISIONS.md`
  and to other threads' inboxes; never rewrite lines someone else wrote. That keeps merges conflict-free.
- Pull `main` (`git fetch origin main && git merge origin/main`) at the start of every node so you see
  the latest state.
- Anything another thread must see **before** your PR merges also goes to them as a direct thread
  message (section 6).

## 2. Nodes

Each node has one job, a narrow context and a defined output. Run them as subagents where the person
or this file asks for it; otherwise role-switch explicitly and say which node you are in.

| Node | Job | Reads | Writes |
|---|---|---|---|
| Planner | Turn the goal into a spec and a task graph | brain, goal, STATE | SPEC, STATE, task list |
| Researcher | Pull prior knowledge and external facts before any build | brain, web, SPEC | RESEARCH |
| Builder | Implement exactly one task from the graph | SPEC, RESEARCH, STATE, code | code, STATE |
| Tester | Write and run tests for the task; never fixes code | SPEC, TESTS, code | TESTS, STATE |
| Reviewer | Check the diff against SPEC and DECISIONS; approve or reject with reasons | SPEC, diff, DECISIONS | STATE |
| Integrator | Merge passing work, run the full suite, resolve conflicts between threads | all | code, STATE, THREADS |

Only one thread holds the Integrator role at a time. It is named in `THREADS.md` (today:
`graph`, the "Set up graph engineering workflow" thread).

## 3. Edges (routing is fixed, not improvised)

```
Planner → Researcher → Builder → Tester
Tester pass   → Reviewer
Tester fail   → Builder (with the failing output attached)   [max 3 retries]
Reviewer ok   → Integrator → next task → Builder
Reviewer no   → Builder (with reasons)                        [max 2 retries]
Retry limit hit, or any new open question → STOP and ask Atishay
Integrator full-suite fail → Builder on the breaking task
No tasks left and full suite green → Exit check (section 7)
```

Never skip Tester. Never let Builder mark its own work done. Never let Reviewer edit code.

In practice a thread's Builder → Tester → Reviewer loop ends in a pull request: Reviewer approval means
the PR is opened (or updated) with the Tester's output in its body, and the Integrator merges it.

## 4. Brain (Obsidian vault) is a first-class source

Atishay's brain is the Obsidian vault in the **`jatishay07/brain`** repo. There are no `vault_*` tools
here; use the repo directly. Its own `CLAUDE.md` is the schema and wins inside that repo.

Before Planner writes the spec and before Researcher goes to the web:
- **Search**: read `index.md` first (it is designed to be sufficient), then `rg -i` the vault for the
  project name, the problem domain, and any library or hardware involved (e.g. `neurochat`, `muse`,
  `eeg`, `eye track`, `ollama`, `qwen`). `raw/conversations/` holds captured Claude sessions.
- **Read** anything relevant. Prior decisions, past failures and existing designs in the vault override
  assumptions.
- Record what was found (or that nothing was found) at the top of `RESEARCH.md`.

At the end of every major milestone, **write back** a short note: what was built, what failed, what was
learned, links to the repo and PRs. Do it on a branch of `jatishay07/brain` and open a PR there:
- update `wiki/neuroai-neurochat.md` (the project page; one concept per page, `tldr:` ≤ 50 chars and
  the vault's required frontmatter);
- add or refresh its line in `index.md`;
- append a `## [YYYY-MM-DD] ingest | NeuroAI milestone: <what>` entry to `log.md`.
Never edit `raw/`, `inbox/`, `daily/` or `drafts/` (Atishay's own words). The vault should be smarter
after this project than before it.

Also keep project memory current for facts a future thread would otherwise have to ask Atishay again.

## 5. Research rules

- Research is a node, not a reflex. Researcher runs once per task before Builder starts, and again only
  if Builder or Tester hits an unknown.
- Prefer primary sources: official docs, datasheets, papers, the library's own repo. Log every source
  in `RESEARCH.md`.
- If two sources conflict, say so and pick one with a reason in `DECISIONS.md`.
- Time-box it. If 15 minutes of research does not resolve the question, record it as an open question
  in `STATE.md` and move on or ask.
- Sandbox limits are known (see `RESEARCH.md`): ollama.com, ghcr blobs, Zenodo, Kaggle, PhysioNet,
  arxiv HTML and jsdelivr are blocked from cloud sessions; GitHub raw and PyPI work; real-Qwen and
  Docker runs happen in GitHub Actions.

## 6. Cross-thread communication

When more than one thread is active (the normal case here):
- **Register** in `THREADS.md` on start. Update your row on every handoff. Deregister (move the row to
  "Finished") when done.
- **Before touching a file**, check `THREADS.md` for the thread that owns it. If another thread owns
  it, post your need in its inbox and wait or work on something else. Do not silently edit shared files.
- **Messages** go two ways, always both:
  1. written to `.graph/inbox/<thread-id>.md` (durable, survives the thread), and
  2. sent directly to that thread with the project's thread messaging (`message_thread`), because the
     inbox file only arrives once your branch merges.
  Each message starts with `REQUEST`, `RESULT` or `CONFLICT`, the date and the sender's thread id.
  Each thread reads its inbox at the start of every node and marks handled messages `[done]`.
- **Shared interfaces** (WebSocket message shapes, window events, HTTP APIs, Python signatures used
  across threads) live in `CONTRACTS.md`. Changing one requires a `DECISIONS.md` entry and a message to
  every thread listed as depending on it.
- **Integrator is the only node that merges** to `main`. It reads all inboxes, resolves conflicts,
  runs the full suite.

## 7. Build → test → iterate, always

Every task follows this cycle, no exceptions:
1. Builder reads STATE, SPEC, RESEARCH. Implements the one task. Writes what changed to STATE.
2. Tester writes tests for the acceptance criteria of that task first, then runs the whole suite
   (`pytest -q`; browser work also gets a Playwright check). Writes the result to TESTS and STATE.
3. On fail → Builder gets the raw failure output, not a summary. Retry counter increments.
4. On pass → Reviewer. On approval → Integrator. On merge → `DECISIONS.md` entry if anything
   non-obvious was decided.
5. Pick the next task. Repeat.

Exit check runs when the task graph is empty: full suite green, every acceptance criterion in SPEC
checked off with evidence, STATE says no open questions, vault note written. If any of these fail,
generate the remaining tasks and keep going.

## 8. Stop conditions (ask Atishay)

Stop and ask instead of guessing when:
- a retry limit is hit;
- the spec is ambiguous in a way that changes architecture;
- a change would delete data, touch secrets, spend money, or alter something outside the repo;
- two threads disagree on a contract and neither has a clear reason to win;
- research found something that invalidates the plan.

State the question, the options and your recommendation in `STATE.md` and in the thread (a decision
card when the choice is his), then wait on that question while continuing any work that does not
depend on it.

## 9. Reporting

At every handoff, one line on the thread's checklist: `[node] task → result → next node`. No narration
beyond that. Reply to Atishay only with results, blockers or questions. At the end: a short summary of
what shipped, what is not done, and what the vault note says.

**Start now:** pull `main`, read `.graph/STATE.md` and `.graph/inbox/<your-thread-id>.md`, register in
`.graph/THREADS.md`. If STATE is missing, enter Planner and query the brain.
