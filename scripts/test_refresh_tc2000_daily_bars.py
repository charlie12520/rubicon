"""Unit tests for the TC2000 export ingest hardening in refresh-tc2000-daily-bars.py.

Run with: python scripts/test_refresh_tc2000_daily_bars.py
(stdlib only; does not touch IBKR.)
"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent / "refresh-tc2000-daily-bars.py"
spec = importlib.util.spec_from_file_location("refresh_tc2000_daily_bars", SCRIPT_PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


def write_csv(path: Path, symbols: list[str], mtime_offset_s: float = 0.0) -> None:
    rows = ["symbol,screen"] + [f"{symbol},Three Bar Rule Spike" for symbol in symbols]
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    if mtime_offset_s:
        stamp = time.time() + mtime_offset_s
        os.utime(path, (stamp, stamp))


class IsPlausibleTickerTest(unittest.TestCase):
    def test_accepts_real_tickers(self) -> None:
        for symbol in ["AAPL", "F", "NVDA", "GOOGL", "BRK.A", "BF-B"]:
            self.assertTrue(mod.is_plausible_ticker(symbol), symbol)

    def test_rejects_known_ocr_junk(self) -> None:
        # The 2026-06-03 failure emitted price fragments, exchange names, and
        # OTC tiers as "symbols".
        for symbol in ["346P", "NYSE", "PINK", "7370", "", "AB12", "TOOLONGX", "NASDAQ"]:
            self.assertFalse(mod.is_plausible_ticker(symbol), symbol)


class SelectExportFilesTest(unittest.TestCase):
    def test_prefers_latest_files_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "qullamaggie_latest.csv", ["AAPL"])
            write_csv(root / "staircase_latest.csv", ["MSFT"])
            # Newer dated export must still be ignored when _latest files exist.
            write_csv(root / "qullamaggie_tc2000_export_20990101_000000.csv", ["STALE"], mtime_offset_s=60)
            selected = {path.name for path in mod.select_export_files(root)}
            self.assertEqual(selected, {"qullamaggie_latest.csv", "staircase_latest.csv"})

    def test_falls_back_to_single_newest_csv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "export_old.csv", ["OLDA"], mtime_offset_s=-120)
            write_csv(root / "export_new.csv", ["NEWA"])
            selected = [path.name for path in mod.select_export_files(root)]
            self.assertEqual(selected, ["export_new.csv"])

    def test_include_all_restores_union(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "qullamaggie_latest.csv", ["AAPL"])
            write_csv(root / "export_old.csv", ["OLDA"], mtime_offset_s=-120)
            selected = {path.name for path in mod.select_export_files(root, include_all=True)}
            self.assertEqual(selected, {"qullamaggie_latest.csv", "export_old.csv"})

    def test_missing_root_returns_empty(self) -> None:
        self.assertEqual(mod.select_export_files(Path("Z:/does/not/exist")), [])


class ReadTc2000ExportSymbolsTest(unittest.TestCase):
    def test_filters_junk_and_reports_rejects(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "qullamaggie_latest.csv", ["AAPL", "346P", "NYSE", "nvda", "PINK"])
            symbols, sources, rejected = mod.read_tc2000_export_symbols(root)
            self.assertEqual(symbols, ["AAPL", "NVDA"])
            self.assertEqual(len(sources), 1)
            self.assertEqual(sorted(rejected), ["346P", "NYSE", "PINK"])

    def test_stale_dated_export_does_not_pollute_union(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "qullamaggie_latest.csv", ["AAPL"])
            write_csv(root / "qullamaggie_tc2000_export_20990101_000000.csv", ["STALE"], mtime_offset_s=60)
            symbols, _sources, _rejected = mod.read_tc2000_export_symbols(root)
            self.assertEqual(symbols, ["AAPL"])

    def test_reports_source_freshness_details(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "qullamaggie_latest.csv", ["AAPL"], mtime_offset_s=-120)
            write_csv(root / "staircase_latest.csv", ["MSFT"], mtime_offset_s=60)
            fresh_after = mod.source_updated_at(root / "qullamaggie_latest.csv")

            symbols, sources, _rejected, details = mod.read_tc2000_export_symbols_with_details(
                root,
                fresh_after=fresh_after,
            )

            self.assertEqual(symbols, ["MSFT", "AAPL"])
            self.assertEqual(len(sources), 2)
            self.assertEqual(len(details), 2)
            self.assertEqual(mod.source_freshness_status(details, fresh_after), "fresh")
            self.assertTrue(all(detail["fresh"] for detail in details))

    def test_marks_stale_and_partial_stale_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_csv(root / "old_latest.csv", ["AAPL"], mtime_offset_s=-120)
            write_csv(root / "new_latest.csv", ["MSFT"], mtime_offset_s=60)
            fresh_after = mod.source_updated_at(root / "new_latest.csv")

            _symbols, _sources, _rejected, details = mod.read_tc2000_export_symbols_with_details(
                root,
                fresh_after=fresh_after,
            )

            self.assertEqual(mod.source_freshness_status(details, fresh_after), "partial-stale")
            self.assertEqual(sum(1 for detail in details if detail.get("fresh") is False), 1)

    def test_no_sources_are_stale_when_freshness_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fresh_after = mod.parse_fresh_after("2026-06-11T12:00:00Z")

            _symbols, _sources, _rejected, details = mod.read_tc2000_export_symbols_with_details(
                root,
                fresh_after=fresh_after,
            )

            self.assertEqual(details, [])
            self.assertEqual(mod.source_freshness_status(details, fresh_after), "stale")


if __name__ == "__main__":
    sys.exit(unittest.main(verbosity=2))
