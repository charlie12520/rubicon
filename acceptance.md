# Acceptance Ledger

Final verdict ledger for merged work. Only the merge agent edits this file.

New merge numbering starts at `MERGE-001`. The merge agent assigns the next `MERGE-###` from this file and updates `Latest accepted merge` every time.

Do not add an accepted entry until the task work is merged and validation is sufficient. If validation is incomplete, record the gap in the task file and ask the user before accepting it.

## Current State

Status:
Latest accepted merge:
Open risks:
Deferred:

## Status Values

- `accepted`: merged, validated, and no blocking risk remains.
- `accepted_with_risk`: merged and usable, with a named non-blocking risk.
- `deferred`: not accepted in this merge; explicitly left for later.

## Accepted Work

| Merge | Date | Tasks | Status | Proof |
|---|---|---|---|---|
| MERGE-001 | YYYY-MM-DD | TASK-001, TASK-002 | accepted | Compact validation proof and any remaining risk. |

## Evidence Standard

Use the narrowest proof that can catch the likely failure. Follow `validation.md`; keep compact proof in `proof.md`.
