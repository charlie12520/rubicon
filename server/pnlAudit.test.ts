import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditPnl, auditPnlDate, defaultPnlAuditRoot, formatPnlAuditMarkdown } from "./pnlAudit.ts";

type CsvRecord = Record<string, string | number | null | undefined>;

const DATE = "2026-06-08";
const ENTRY_HEADERS = [
  "target_trade_date_et",
  "account",
  "perm_id",
  "entry_sequence",
  "entry_action",
  "entry_time_et",
  "spread_key",
  "position_before",
  "position_after",
  "entry_quantity",
  "entry_price",
  "entry_credit_debit",
  "spread_class",
  "legs",
  "total_commission",
  "exit_time_et",
  "exit_perm_id",
  "exit_action",
  "exit_price",
  "exit_total_commission",
  "lifecycle_status",
  "expiration_date",
  "expiration_price",
  "expiration_spx_close",
] as const;
const FILL_HEADERS = ["target_trade_date_et", "perm_id", "sec_type", "local_symbol", "last_trade_date_or_contract_month", "realized_pnl"] as const;

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((target) => fs.rm(target, { force: true, recursive: true })));
  tempDirs = [];
});

describe("Daily Review PnL audit", () => {
  it("reconciles a 06-08-style day with raw closed realized PnL plus expired credits", async () => {
    const root = await tempArchiveRoot();
    await writeDay(root, DATE, {
      entries: [
        entryRow({ entry_sequence: "1", perm_id: "100", exit_perm_id: "EXPIRATION", exit_price: "0", lifecycle_status: "Expired" }),
        entryRow({
          entry_sequence: "2",
          entry_time_et: "2026-06-08T09:31:48-04:00",
          perm_id: "200",
          exit_perm_id: "201",
          exit_price: "-0.7",
          exit_total_commission: "25.815",
          lifecycle_status: "Closed",
        }),
      ],
      fills: [fillRow({ perm_id: "201", realized_pnl: "-451.63" })],
    });

    const result = await auditPnlDate(root, DATE);

    expect(result.status).toBe("pass");
    expect(result.entryCount).toBe(2);
    expect(result.fillCount).toBe(1);
    expect(result.dailyReviewPnl).toBe(-177.45);
    expect(result.archiveTruthPnl).toBe(-177.45);
    expect(result.delta).toBe(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.kind === "expiration" && diagnostic.archiveTruthPnl === 274.19)).toBe(true);
  });

  it("fails when raw realized close PnL drifts from Daily Review entry math", async () => {
    const root = await tempArchiveRoot();
    await writeDay(root, DATE, {
      entries: [
        entryRow({
          entry_sequence: "2",
          perm_id: "200",
          exit_perm_id: "201",
          exit_price: "-0.7",
          exit_total_commission: "25.815",
          lifecycle_status: "Closed",
        }),
      ],
      fills: [fillRow({ perm_id: "201", realized_pnl: "-400" })],
    });

    const result = await auditPnlDate(root, DATE);

    expect(result.status).toBe("fail");
    expect(result.dailyReviewPnl).toBe(-451.63);
    expect(result.archiveTruthPnl).toBe(-400);
    expect(result.delta).toBe(-51.63);
    expect(result.issues.join(" ")).toContain("Daily Review PnL differs from archive truth");
  });

  it("reconciles multiple entries closed by one raw exit perm", async () => {
    const root = await tempArchiveRoot();
    await writeDay(root, DATE, {
      entries: [
        entryRow({
          entry_price: "-0.5",
          entry_quantity: "5",
          entry_sequence: "1",
          exit_perm_id: "300",
          exit_price: "-0.8",
          lifecycle_status: "Closed",
          perm_id: "101",
        }),
        entryRow({
          entry_price: "-0.4",
          entry_quantity: "5",
          entry_sequence: "2",
          exit_perm_id: "300",
          exit_price: "-0.8",
          lifecycle_status: "Closed",
          perm_id: "102",
        }),
      ],
      fills: [fillRow({ perm_id: "300", realized_pnl: "-401.63" })],
    });

    const result = await auditPnlDate(root, DATE);

    expect(result.status).toBe("pass");
    expect(result.dailyReviewPnl).toBe(-401.63);
    expect(result.archiveTruthPnl).toBe(-401.63);
    expect(result.diagnostics.find((diagnostic) => diagnostic.exitPermId === "300")?.note).toContain("2 Daily Review entries");
  });

  it("fails clearly when entries exist but fills.csv is missing", async () => {
    const root = await tempArchiveRoot();
    await writeDay(root, DATE, {
      entries: [entryRow({ exit_perm_id: "201", exit_price: "-0.7", lifecycle_status: "Closed" })],
      fills: null,
    });

    const result = await auditPnlDate(root, DATE);

    expect(result.status).toBe("fail");
    expect(result.issues.join(" ")).toContain("fills.csv missing");
    expect(result.issues.join(" ")).toContain("No raw realized PnL found");
  });

  it("skips no-trade days instead of failing the historical report", async () => {
    const root = await tempArchiveRoot();
    const dayDir = path.join(root, DATE);
    await fs.mkdir(dayDir, { recursive: true });
    await writeCsv(path.join(dayDir, "entries.csv"), [], ENTRY_HEADERS);

    const result = await auditPnlDate(root, DATE);

    expect(result.status).toBe("skipped");
    expect(result.entryCount).toBe(0);
    expect(result.issues.join(" ")).toContain("No SPX spread entries");
  });

  it("formats a compact markdown report", async () => {
    const root = await tempArchiveRoot();
    await writeDay(root, DATE, {
      entries: [entryRow({ exit_perm_id: "EXPIRATION", exit_price: "0", lifecycle_status: "Expired" })],
      fills: [],
    });

    const result = await auditPnl({ date: DATE, root });
    const markdown = formatPnlAuditMarkdown(result);

    expect(markdown).toContain("# Daily Review PnL Audit");
    expect(markdown).toContain("| 2026-06-08 | pass | 1 | 0 | $274.19 | $274.19 | $0.00 |  |");
  });
});

const archiveRoot = defaultPnlAuditRoot();
const hasLocal0608Archive = existsSync(path.join(archiveRoot, "2026-06-08", "entries.csv"));
const itArchive = it.skipIf(!hasLocal0608Archive);

describe("Daily Review PnL audit local archive", () => {
  itArchive("reconciles the recorded 2026-06-08 Daily Review PnL", async () => {
    const result = await auditPnlDate(archiveRoot, "2026-06-08");

    expect(result.status).toBe("pass");
    expect(result.entryCount).toBe(17);
    expect(result.fillCount).toBe(223);
    expect(result.dailyReviewPnl).toBe(-2242.13);
    expect(result.archiveTruthPnl).toBe(-2242.13);
  });
});

async function tempArchiveRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-pnl-audit-"));
  tempDirs.push(root);
  return root;
}

async function writeDay(root: string, date: string, input: { entries: CsvRecord[]; fills: CsvRecord[] | null }): Promise<void> {
  const dayDir = path.join(root, date);
  await fs.mkdir(dayDir, { recursive: true });
  await writeCsv(path.join(dayDir, "entries.csv"), input.entries, ENTRY_HEADERS);
  if (input.fills !== null) {
    await writeCsv(path.join(dayDir, "fills.csv"), input.fills, FILL_HEADERS);
  }
}

function entryRow(overrides: CsvRecord = {}): CsvRecord {
  return {
    target_trade_date_et: DATE,
    account: "U19610351",
    perm_id: "100",
    entry_sequence: "1",
    entry_action: "entry",
    entry_time_et: "2026-06-08T09:30:40-04:00",
    spread_key: JSON.stringify([
      { abs_ratio: 1, expiration: "20260608", local_symbol: "SPXW  260608P07360000", right: "P", strike: 7360 },
      { abs_ratio: 1, expiration: "20260608", local_symbol: "SPXW  260608P07365000", right: "P", strike: 7365 },
    ]),
    position_before: "0",
    position_after: "10",
    entry_quantity: "10",
    entry_price: "-0.3",
    entry_credit_debit: "credit",
    spread_class: "put_credit_vertical",
    legs: "SPXW  260608P07360000 BOT net=10 avg=2.65 | SPXW  260608P07365000 SLD net=-10 avg=2.95",
    total_commission: "25.815",
    exit_time_et: "2026-06-08T16:00:00-04:00",
    exit_perm_id: "EXPIRATION",
    exit_action: "expiration",
    exit_price: "0",
    exit_total_commission: "0",
    lifecycle_status: "Expired",
    expiration_date: DATE,
    expiration_price: "0",
    expiration_spx_close: "7405.81",
    ...overrides,
  };
}

function fillRow(overrides: CsvRecord = {}): CsvRecord {
  return {
    target_trade_date_et: DATE,
    perm_id: "201",
    sec_type: "OPT",
    local_symbol: "SPXW  260608P07365000",
    last_trade_date_or_contract_month: "20260608",
    realized_pnl: "0",
    ...overrides,
  };
}

async function writeCsv(target: string, rows: CsvRecord[], headers: readonly string[]): Promise<void> {
  const body = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  await fs.writeFile(target, `${body}\n`, "utf8");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
