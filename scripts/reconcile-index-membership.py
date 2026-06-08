"""Reconcile S&P 500 / Nasdaq-100 membership for the heatmap.

Detects index reconstitutions (adds/drops) by diffing the live holdings against a
stored snapshot, auto-classifies NEW names to the correct Finviz SECTOR (GICS->Finviz
crosswalk; industry left as "Unclassified" for manual placement), writes an auto-overlay
the loader merges UNDER the hand-curated finviz-classification.json (base always wins),
updates the snapshot, and appends a changelog. Emits one JSON line on stdout so the
server hook can fire a toast. A safety gate refuses suspicious deltas so a flaky source
can never nuke the universe.

stdlib-only (imports helpers from refresh-spx-heatmap.py). Default is a dry-run.

Exit codes: 0 = no change / applied cleanly; 10 = changes detected (dry-run); 20 = gate tripped.
"""
import argparse
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SCRIPT_DIR = Path(__file__).resolve().parent
APP_ROOT = SCRIPT_DIR.parent
DATA_DIR = APP_ROOT / "data"
SNAPSHOT_PATH = DATA_DIR / "heatmap-membership.json"
OVERLAY_PATH = DATA_DIR / "heatmap-classification-auto.json"
CHANGELOG_PATH = DATA_DIR / "heatmap-membership-changelog.json"
CHANGELOG_CAP = 500
AUTO_INDUSTRY = "Unclassified"

# GICS (Wikipedia/SSGA) -> Finviz sector names (the taxonomy finviz-classification.json uses).
GICS_TO_FINVIZ = {
    "Information Technology": "Technology",
    "Health Care": "Healthcare",
    "Financials": "Financial",
    "Consumer Discretionary": "Consumer Cyclical",
    "Consumer Staples": "Consumer Defensive",
    "Materials": "Basic Materials",
    "Communication Services": "Communication Services",
    "Industrials": "Industrials",
    "Energy": "Energy",
    "Utilities": "Utilities",
    "Real Estate": "Real Estate",
}
FLOORS = {"spx": 480, "qqq": 95}  # a fetch returning fewer than this is treated as garbage
PAYLOAD_FILES = {"spx": "spx-heatmap.json", "qqq": "qqq-heatmap.json"}


def norm(ticker: str) -> str:
    """Normalize a symbol so BRK.B / BRK-B / brkb all collide (mirrors classKey)."""
    return "".join(ch for ch in str(ticker).upper() if ch.isalnum())


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — missing/corrupt file → default (tolerant)
        return default


def _load_feed_module():
    """Import the hyphenated refresh-spx-heatmap.py as a module to reuse its loaders."""
    spec = importlib.util.spec_from_file_location("refresh_spx_heatmap", SCRIPT_DIR / "refresh-spx-heatmap.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def current_from_live(index_ids: list[str]) -> dict:
    """Fresh membership+weights+GICS sector per index via the feed's own loaders
    (for_live=False forces a fresh SSGA/Slickcharts pull + apply_sectors)."""
    mod = _load_feed_module()
    _union, cfgs = mod.build_index_configs(index_ids, for_live=False)
    out: dict = {}
    for cfg in cfgs:
        members = {}
        for sym in cfg["order"]:
            meta = cfg["meta"].get(sym) or {}
            members[norm(sym)] = {
                "symbol": sym,
                "weight": round(float(cfg["weight"].get(sym, 0.0) or 0.0), 4),
                "gics": str(meta.get("sector", "") or ""),
            }
        out[cfg["id"]] = {"source": cfg.get("universeSource", ""), "members": members}
    return out


def current_from_payload(index_ids: list[str]) -> dict:
    """Offline membership from the existing heatmap payloads (for --source sample / tests)."""
    out: dict = {}
    for idx in index_ids:
        payload = _read_json(DATA_DIR / PAYLOAD_FILES.get(idx, f"{idx}-heatmap.json"), {}) or {}
        members = {}
        for tile in payload.get("tiles", []) if isinstance(payload, dict) else []:
            sym = str(tile.get("symbol", "")).strip()
            if not sym:
                continue
            members[norm(sym)] = {
                "symbol": sym,
                "weight": round(float(tile.get("weight") or 0.0), 4),
                "gics": str(tile.get("sector", "") or ""),
            }
        out[idx] = {"source": "existing-payload", "members": members}
    return out


def classify_add(info: dict) -> tuple[str, str, str]:
    """New name -> (FinvizSector, industry, via). Sector auto; industry deferred to manual."""
    sector = GICS_TO_FINVIZ.get(str((info or {}).get("gics", "")))
    if sector:
        return sector, AUTO_INDUSTRY, "gics-sector"
    return "Other", AUTO_INDUSTRY, "no-sector"  # Wikipedia lag / QQQ-only — flagged in the toast


def apply_overlay(overlay: dict, added: list[dict], dropped: list[dict]) -> dict:
    """Mutate the auto-overlay: drop departed symbols from any Unclassified bucket, add new ones."""
    drop_keys = {norm(d["symbol"]) for d in dropped}
    for sector in list(overlay.keys()):
        inds = overlay[sector]
        if not isinstance(inds, dict):
            continue
        for industry in list(inds.keys()):
            kept = [s for s in inds[industry] if norm(s) not in drop_keys]
            if kept:
                inds[industry] = kept
            else:
                del inds[industry]
        if not inds:
            del overlay[sector]
    for add in added:
        bucket = overlay.setdefault(add["sector"], {}).setdefault(add["industry"], [])
        if add["symbol"] not in bucket:
            bucket.append(add["symbol"])
    return overlay


def reconcile(index_ids: list[str], source: str, apply_changes: bool, max_churn_pct: float) -> tuple[dict, int]:
    current = current_from_live(index_ids) if source == "live" else current_from_payload(index_ids)
    snapshot = _read_json(SNAPSHOT_PATH, {}) or {}
    snap_idx = dict(snapshot.get("indexes", {}))
    overlay = _read_json(OVERLAY_PATH, {}) or {}
    now = datetime.now(timezone.utc).isoformat()

    result = {"ok": True, "applied": False, "gate": "pass", "indexes": {}}
    changelog_entries: list[dict] = []
    any_change = False
    any_write = False
    gate_blocked = False

    for idx in index_ids:
        cur = current.get(idx, {"members": {}, "source": ""})
        cur_members = cur["members"]
        prior = snap_idx.get(idx)
        floor = FLOORS.get(idx, 0)
        idx_res = {"added": [], "dropped": [], "bootstrapped": False, "gate": "pass", "count": len(cur_members)}

        # Gate 1 — download sanity (truncated/garbage fetch).
        if len(cur_members) < floor:
            idx_res["gate"] = "blocked"
            idx_res["reason"] = f"only {len(cur_members)} members (< floor {floor})"
            result["gate"] = "blocked"
            gate_blocked = True
            changelog_entries.append({"at": now, "index": idx, "gate": "blocked", "reason": idx_res["reason"], "count": len(cur_members)})
            result["indexes"][idx] = idx_res
            continue

        # First run / missing snapshot → seed silently (no toast, no phantom 500 adds).
        if not prior or not prior.get("members"):
            idx_res["bootstrapped"] = True
            snap_idx[idx] = {"source": cur["source"], "count": len(cur_members),
                             "members": {k: {"symbol": v["symbol"], "weight": v["weight"]} for k, v in cur_members.items()}}
            changelog_entries.append({"at": now, "index": idx, "bootstrapped": True, "count": len(cur_members)})
            any_write = True
            result["indexes"][idx] = idx_res
            continue

        prior_members = prior["members"]
        prior_count = max(1, int(prior.get("count", len(prior_members))))
        added_keys = [k for k in cur_members if k not in prior_members]
        dropped_keys = [k for k in prior_members if k not in cur_members]
        churn = len(added_keys) + len(dropped_keys)

        # Gate 2 — churn cap (a real reconstitution moves a handful; a big delta = bad fetch).
        if churn > prior_count * max_churn_pct / 100.0:
            idx_res["gate"] = "blocked"
            idx_res["reason"] = f"churn {churn} > {max_churn_pct}% of {prior_count}"
            result["gate"] = "blocked"
            gate_blocked = True
            changelog_entries.append({"at": now, "index": idx, "gate": "blocked", "reason": idx_res["reason"],
                                      "addedCount": len(added_keys), "droppedCount": len(dropped_keys)})
            result["indexes"][idx] = idx_res
            continue

        added = []
        for k in added_keys:
            info = cur_members[k]
            sector, industry, via = classify_add(info)
            added.append({"symbol": info["symbol"], "sector": sector, "industry": industry, "via": via, "weight": info["weight"]})
        dropped = [{"symbol": prior_members[k].get("symbol", k), "weight": prior_members[k].get("weight")} for k in dropped_keys]
        idx_res["added"] = added
        idx_res["dropped"] = dropped

        if added or dropped:
            any_change = True
            apply_overlay(overlay, added, dropped)
            snap_idx[idx] = {"source": cur["source"], "count": len(cur_members),
                             "members": {k: {"symbol": v["symbol"], "weight": v["weight"]} for k, v in cur_members.items()}}
            changelog_entries.append({"at": now, "index": idx, "added": added, "dropped": dropped, "source": cur["source"], "gate": "pass"})
            any_write = True
        result["indexes"][idx] = idx_res

    if apply_changes and any_write:
        mod = _load_feed_module()
        mod.write_json_atomic(OVERLAY_PATH, overlay)
        mod.write_json_atomic(SNAPSHOT_PATH, {"version": 1, "updatedAt": now, "indexes": snap_idx})
        existing_log = _read_json(CHANGELOG_PATH, [])
        if not isinstance(existing_log, list):
            existing_log = []
        existing_log.extend(changelog_entries)
        mod.write_json_atomic(CHANGELOG_PATH, existing_log[-CHANGELOG_CAP:])
        result["applied"] = True

    if gate_blocked:
        return result, 20
    if any_change and not apply_changes:
        return result, 10
    return result, 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile S&P 500 / Nasdaq-100 heatmap membership.")
    parser.add_argument("--indexes", default="spx,qqq", help="comma list of indices to reconcile")
    parser.add_argument("--source", choices=["live", "sample"], default="live",
                        help="live = fresh SSGA/Slickcharts pull; sample = existing payloads (offline)")
    parser.add_argument("--apply", action="store_true", help="write overlay/snapshot/changelog (default: dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="never write (overrides --apply)")
    parser.add_argument("--max-churn-pct", type=float, default=5.0, help="safety gate: max %% of members that may change")
    args = parser.parse_args()

    index_ids = [s.strip().lower() for s in args.indexes.split(",") if s.strip()] or ["spx"]
    apply_changes = args.apply and not args.dry_run
    try:
        result, code = reconcile(index_ids, args.source, apply_changes, args.max_churn_pct)
    except Exception as exc:  # noqa: BLE001 — never crash the server hook; report + exit 20
        print(json.dumps({"ok": False, "applied": False, "gate": "error", "error": str(exc)}))
        return 20
    print(json.dumps(result, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
