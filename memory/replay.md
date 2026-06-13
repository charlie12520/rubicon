# Replay Memory

Copied from `DECISIONS.md`. Keep the original decision blocks intact.

### D004: Spread chart truth model

Decision:
Spread replay charts distinguish close-only Line mode from OHLC HL mode. Imported spread marks carry leg-symbol metadata, and fallback reconstruction combines every option leg's signed open/high/low/close values instead of drawing close-only bars.

Reason:
A credit/debit spread can look deceptively flat if high/low bars collapse to the close. The UI should make real intraminute range visible when it exists, while the importer should prove every displayed spread mark represents the complete two-leg trade.

Status:
Accepted

## Changelog

Changelog rows are newest-first: add each new row directly below the table header.

| Date | Merge | Notes |
|---|---|---|
| 2026-06-13 | MERGE-004 | Market-data-only replay days preserve SPX bars, 0DTE OI, and volume-profile context even when no spread is selected. |
| 2026-06-13 | MERGE-001 | Established section memory baseline and newest-first changelog rule during TASK-007 docs/runtime merge. |
