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

| Date | Merge | Notes |
|---|---|---|
