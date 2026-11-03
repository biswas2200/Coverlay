# Work queue

Small tasks saved for later. Nothing here is worked on until the owner says so.

## How it works

- **Add:** "add to queue: <task>" → the task goes to the bottom of **To do** with the date.
- **Run:** "complete the queue" → tasks are done top to bottom, one commit each, then moved
  to **Done** with the date and commit. "do Q3" runs just that one.
- A task that needs a decision or turns out bigger than "small" is not guessed at: it stays
  in **To do** with a note saying what is needed, and the next task is started.

## To do

| ID | Added | Task | Notes |
|---|---|---|---|
| Q1 | 2026-11-03 | Rewrite the design docs in `docs/` | Match the code after commit 51fa31f: no Free/Premium tiers, Gemini reads every domain, NER archived. About 300 mentions across `srs.md`, `architecture.md`, `hld.md`, `lld.md`, `editions-and-parity.md`, `use-case-diagram.md` and others. Remove the "Changed in November 2026" note from `docs/index.md` when done; `mkdocs build --strict` must pass. |

## Done

| ID | Added | Done | Task | Commit |
|---|---|---|---|---|
