# Daily Review Memory

Copied from `DECISIONS.md`. Keep the original decision blocks intact.

### D005: Daily review note persistence

Decision:
Daily Review notes are persisted locally by trade date in app-local `data/review-notes.json`.

Reason:
The local MVP needs lightweight session reflection without requiring a hosted database, account system, or Google write access.

Status:
Accepted

## Changelog

Changelog rows are newest-first: add each new row directly below the table header.

| Date | Merge | Notes |
|---|---|---|
| 2026-06-13 | MERGE-001 | Established section memory baseline and newest-first changelog rule during TASK-007 docs/runtime merge. |
