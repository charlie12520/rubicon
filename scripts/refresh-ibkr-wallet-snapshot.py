from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from ib_insync import IB
except ImportError:
    print("ib_insync is required for IBKR wallet refresh. Install it in the Python runtime used by IBKR_WALLET_PYTHON.", file=sys.stderr)
    raise SystemExit(4)


ET = ZoneInfo("America/New_York")
DEFAULT_PORTS = "7496,4001"


def parse_ports(value: str) -> list[int]:
    ports: list[int] = []
    for raw in value.split(","):
        raw = raw.strip()
        if not raw:
            continue
        port = int(raw)
        if port <= 0 or port > 65535:
            raise ValueError(f"invalid port {port}")
        ports.append(port)
    if not ports:
        raise ValueError("at least one IBKR port is required")
    return list(dict.fromkeys(ports))


def default_out_path() -> Path:
    project_root = Path(__file__).resolve().parents[1]
    ai_stuff_root = Path(os.environ.get("AI_STUFF_ROOT", project_root.parent))
    return ai_stuff_root / "IBKR Equity History Pull" / "data" / "ibkr_account_snapshot.json"


def clean_float(value: object) -> float | None:
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def row_to_dict(row: object) -> dict[str, str]:
    return {
        "account": str(getattr(row, "account", "") or ""),
        "tag": str(getattr(row, "tag", "") or ""),
        "value": str(getattr(row, "value", "") or ""),
        "currency": str(getattr(row, "currency", "") or ""),
    }


def write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh an IBKR NetLiquidation account snapshot from read-only TWS/Gateway API.")
    parser.add_argument("--host", default=os.environ.get("IBKR_HOST", "127.0.0.1"))
    parser.add_argument("--ports", default=os.environ.get("IBKR_WALLET_PORTS", os.environ.get("IBKR_PORTS", DEFAULT_PORTS)))
    parser.add_argument("--client-id", type=int, default=int(os.environ.get("IBKR_WALLET_CLIENT_ID", "872")))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("IBKR_WALLET_TIMEOUT_SECONDS", "8")))
    parser.add_argument("--account", default=os.environ.get("IBKR_ACCOUNT", ""))
    parser.add_argument("--out", type=Path, default=Path(os.environ.get("IBKR_ACCOUNT_SNAPSHOT_OUT_PATH", default_out_path())))
    args = parser.parse_args()

    ports = parse_ports(args.ports)
    errors: list[dict[str, object]] = []

    for index, port in enumerate(ports):
        ib = IB()
        try:
            ib.connect(args.host, port, clientId=args.client_id + index, timeout=args.timeout, readonly=True)
            rows = [row_to_dict(row) for row in ib.accountSummary()]
            if args.account:
                rows = [row for row in rows if row["account"] == args.account]

            net_rows = [row for row in rows if row["tag"].replace(" ", "").lower() == "netliquidation"]
            if not net_rows:
                errors.append({"host": args.host, "port": port, "error": "connected but no NetLiquidation account summary row was returned"})
                continue

            selected = net_rows[0]
            net_liquidation = clean_float(selected["value"])
            if net_liquidation is None:
                errors.append({"host": args.host, "port": port, "error": f"NetLiquidation value was not numeric: {selected['value']!r}"})
                continue

            fetched_at = datetime.now(ET).isoformat()
            payload: dict[str, object] = {
                "source": "IBKR_TWS_API",
                "host": args.host,
                "port": port,
                "client_id": args.client_id + index,
                "fetchedAt": fetched_at,
                "account": selected["account"],
                "netLiquidation": net_liquidation,
                "currency": selected["currency"],
                "account_summary": rows,
            }
            write_json_atomic(args.out, payload)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "outPath": str(args.out),
                        "account": selected["account"],
                        "fetchedAt": fetched_at,
                        "netLiquidation": net_liquidation,
                        "port": port,
                    }
                )
            )
            return 0
        except Exception as exc:
            errors.append({"host": args.host, "port": port, "error": repr(exc)})
        finally:
            if ib.isConnected():
                ib.disconnect()

    print(
        "Could not refresh IBKR wallet snapshot from read-only TWS/Gateway API. "
        f"Checked {args.host}:{','.join(map(str, ports))}. Errors: {json.dumps(errors)}",
        file=sys.stderr,
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
