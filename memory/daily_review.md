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

| Date | Merge | Notes |
|---|---|---|
