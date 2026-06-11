import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import type { SourceHealth } from "../shared/types.ts";

const execFileAsync = promisify(execFile);

const AI_STUFF_ROOT = process.env.AI_STUFF_ROOT ?? path.resolve(process.cwd(), "..");
const IBKR_ROOT = path.join(AI_STUFF_ROOT, "IBKR Equity History Pull");
const DEFAULT_IBKR_HOST = "127.0.0.1";
const DEFAULT_IBKR_PORTS = "7496,4001";
const DEFAULT_CLIENT_ID = 872;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 8;
const DEFAULT_PROBE_TIMEOUT_MS = 350;
const DEFAULT_REFRESH_TIMEOUT_MS = 20_000;

export type IbkrWalletRefreshSummary = {
  outPath: string;
  account?: string;
  fetchedAt?: string;
  netLiquidation?: number;
  port?: number;
};

type PythonRefreshResult = Partial<IbkrWalletRefreshSummary> & {
  ok?: boolean;
  message?: string;
};

export function ibkrWalletSnapshotPath(): string {
  return process.env.IBKR_ACCOUNT_SNAPSHOT_OUT_PATH || path.join(IBKR_ROOT, "data", "ibkr_account_snapshot.json");
}

export function parseIbkrPorts(value = process.env.IBKR_WALLET_PORTS ?? process.env.IBKR_PORTS ?? DEFAULT_IBKR_PORTS): number[] {
  const ports = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part));

  if (!ports.length || ports.some((port) => !Number.isInteger(port) || port <= 0 || port > 65535)) {
    throw new Error(`IBKR port list must contain valid TCP ports; received "${value}".`);
  }

  return [...new Set(ports)];
}

export async function probeTcpPort(host: string, port: number, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export async function ibkrWalletRefreshSourceHealth(
  probe: (host: string, port: number, timeoutMs?: number) => Promise<boolean> = probeTcpPort,
): Promise<SourceHealth> {
  const host = process.env.IBKR_HOST ?? DEFAULT_IBKR_HOST;

  let ports: number[];
  try {
    ports = parseIbkrPorts();
  } catch (error) {
    return {
      label: "IBKR live wallet refresh",
      status: "warning",
      detail: error instanceof Error ? error.message : "IBKR wallet port configuration is invalid.",
    };
  }

  const checks = await Promise.all(ports.map(async (port) => ({ port, open: await probe(host, port, DEFAULT_PROBE_TIMEOUT_MS) })));
  const openPorts = checks.filter((check) => check.open).map((check) => check.port);

  if (openPorts.length) {
    return {
      label: "IBKR live wallet refresh",
      status: "ok",
      detail: `Read-only TWS/Gateway API socket is reachable at ${host}:${openPorts.join(", ")}; Refresh IBKR Wallet can update NetLiquidation.`,
      count: openPorts.length,
    };
  }

  return {
    label: "IBKR live wallet refresh",
    status: "warning",
    detail: `No TWS/Gateway API socket accepted connections at ${host}:${ports.join(", ")}. Enable the IBKR API socket or keep using a local account snapshot/manual wallet value.`,
  };
}

export async function refreshIbkrWalletSnapshot(): Promise<IbkrWalletRefreshSummary> {
  const scriptPath = path.join(process.cwd(), "scripts", "refresh-ibkr-wallet-snapshot.py");
  const host = process.env.IBKR_HOST ?? DEFAULT_IBKR_HOST;
  const ports = parseIbkrPorts();
  const outPath = ibkrWalletSnapshotPath();
  const pythonCommand = process.env.IBKR_WALLET_PYTHON || process.env.PYTHON || "python";
  const args = [
    scriptPath,
    "--host",
    host,
    "--ports",
    ports.join(","),
    "--client-id",
    String(Number(process.env.IBKR_WALLET_CLIENT_ID ?? DEFAULT_CLIENT_ID)),
    "--timeout",
    String(Number(process.env.IBKR_WALLET_TIMEOUT_SECONDS ?? DEFAULT_CONNECT_TIMEOUT_SECONDS)),
    "--out",
    outPath,
  ];

  if (process.env.IBKR_ACCOUNT) {
    args.push("--account", process.env.IBKR_ACCOUNT);
  }

  try {
    const { stdout } = await execFileAsync(pythonCommand, args, {
      cwd: process.cwd(),
      env: process.env,
      timeout: Number(process.env.IBKR_WALLET_REFRESH_TIMEOUT_MS ?? DEFAULT_REFRESH_TIMEOUT_MS),
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout.trim()) as PythonRefreshResult;

    if (!parsed.ok || !parsed.outPath) {
      throw new Error(parsed.message || "IBKR wallet refresh did not return a snapshot path.");
    }

    return {
      outPath: parsed.outPath,
      account: parsed.account,
      fetchedAt: parsed.fetchedAt,
      netLiquidation: parsed.netLiquidation,
      port: parsed.port,
    };
  } catch (error) {
    const commandError = error as Error & { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    const detail = [commandError.stderr?.trim(), commandError.stdout?.trim(), commandError.message]
      .filter(Boolean)
      .join(" ");
    throw new Error(detail || "IBKR wallet refresh failed.", { cause: error });
  }
}
