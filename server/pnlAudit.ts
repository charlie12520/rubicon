import { statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isSpxSpreadTrade, normalizeTrade, readCsv, type CsvRow } from "./dataImporter.ts";
import { pathExists } from "./jsonStore.ts";

export type PnlAuditStatus = "pass" | "fail" | "skipped";

export type PnlAuditDiagnosticKind = "closed" | "expiration" | "open" | "unmatched_raw";

export type PnlAuditDiagnostic = {
  kind: PnlAuditDiagnosticKind;
  tradeId?: string;
  permId?: string;
  entrySequence?: string;
  exitPermId?: string;
  status?: string;
  entryTime?: string;
  exitTime?: string | null;
  dailyReviewPnl: number;
  archiveTruthPnl: number;
  delta: number;
  note: string;
};

export type PnlAuditDateResult = {
  archiveTruthPnl: number;
  dailyReviewPnl: number;
  date: string;
  dayDir: string;
  delta: number;
  diagnostics: PnlAuditDiagnostic[];
  entryCount: number;
  fillCount: number;
  issues: string[];
  status: PnlAuditStatus;
  tolerance: number;
};

export type PnlAuditRunResult = {
  failed: number;
  from?: string;
  generatedAt: string;
  passed: number;
  results: PnlAuditDateResult[];
  root: string;
  skipped: number;
  status: PnlAuditStatus;
  to?: string;
  tolerance: number;
};

export type PnlAuditOptions = {
  date?: string;
  from?: string;
  root?: string;
  to?: string;
  tolerance?: number;
};

type EntryAuditRow = {
  row: CsvRow;
  trade: ReturnType<typeof normalizeTrade>;
};

const DEFAULT_TOLERANCE = 0.01;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function defaultPnlAuditRoot(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configured = env.AI_STUFF_ROOT?.trim();
  const aiStuffRoot = configured || firstExistingAiStuffRoot(cwd) || path.resolve(cwd, "..");
  return path.join(aiStuffRoot, "IBKR Equity History Pull", "data", "ibkr_trades");
}

export async function auditPnl(options: PnlAuditOptions = {}): Promise<PnlAuditRunResult> {
  const root = path.resolve(options.root ?? defaultPnlAuditRoot());
  const tolerance = normalizeTolerance(options.tolerance);
  const dates = await auditDates(root, options);
  const results = await Promise.all(dates.map((date) => auditPnlDate(root, date, tolerance)));
  const failed = results.filter((result) => result.status === "fail").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const passed = results.filter((result) => result.status === "pass").length;

  return {
    failed,
    from: options.from,
    generatedAt: new Date().toISOString(),
    passed,
    results,
    root,
    skipped,
    status: failed > 0 ? "fail" : passed > 0 ? "pass" : "skipped",
    to: options.to,
    tolerance,
  };
}

export async function auditPnlDate(root: string, date: string, tolerance = DEFAULT_TOLERANCE): Promise<PnlAuditDateResult> {
  const normalizedTolerance = normalizeTolerance(tolerance);
  const dayDir = path.join(root, date);
  const entriesPath = path.join(dayDir, "entries.csv");
  const fillsPath = path.join(dayDir, "fills.csv");
  const issues: string[] = [];

  if (!(await pathExists(dayDir))) {
    return emptyDateResult({
      date,
      dayDir,
      issue: `Date folder missing at ${dayDir}.`,
      status: "fail",
      tolerance: normalizedTolerance,
    });
  }

  if (!(await pathExists(entriesPath))) {
    return emptyDateResult({
      date,
      dayDir,
      issue: `No entries.csv found for ${date}; no Daily Review trades to audit.`,
      status: "skipped",
      tolerance: normalizedTolerance,
    });
  }

  const entryRows = await readCsv(entriesPath);
  const entries = entryRows
    .map((row) => ({ row, trade: normalizeTrade(row, entriesPath) }))
    .filter((entry) => isSpxSpreadTrade(entry.trade));

  if (!entries.length) {
    return emptyDateResult({
      date,
      dayDir,
      issue: `No SPX spread entries found in ${entriesPath}.`,
      status: "skipped",
      tolerance: normalizedTolerance,
    });
  }

  const fillsExists = await pathExists(fillsPath);
  const fillRows = fillsExists ? await readCsv(fillsPath) : [];
  if (!fillsExists) {
    issues.push(`fills.csv missing for ${date} at ${fillsPath}.`);
  }

  const rawRealizedByPerm = realizedPnlByPerm(fillRows, date);
  const referencedExitPerms = new Set<string>();
  const diagnostics: PnlAuditDiagnostic[] = [];
  let expirationArchivePnl = 0;

  for (const group of groupClosedEntriesByExitPerm(entries)) {
    referencedExitPerms.add(group.exitPermId);
    const dailyReviewPnl = roundCurrency(group.entries.reduce((sum, entry) => sum + entry.trade.pnl, 0));
    const archiveTruthPnl = roundCurrency(rawRealizedByPerm.get(group.exitPermId) ?? 0);
    const delta = roundCurrency(dailyReviewPnl - archiveTruthPnl);
    diagnostics.push({
      archiveTruthPnl,
      dailyReviewPnl,
      delta,
      exitPermId: group.exitPermId,
      kind: "closed",
      note: `${group.entries.length} Daily Review entr${group.entries.length === 1 ? "y references" : "ies reference"} raw perm ${group.exitPermId}.`,
    });
  }

  for (const entry of entries) {
    if (isExpirationEntry(entry.row)) {
      const exactArchiveTruthPnl = syntheticExpirationPnl(entry.row);
      const archiveTruthPnl = roundCurrency(exactArchiveTruthPnl);
      const dailyReviewPnl = roundCurrency(entry.trade.pnl);
      const delta = roundCurrency(dailyReviewPnl - archiveTruthPnl);
      expirationArchivePnl += exactArchiveTruthPnl;
      diagnostics.push({
        archiveTruthPnl,
        dailyReviewPnl,
        delta,
        entrySequence: entry.row.entry_sequence,
        entryTime: entry.trade.entryTime,
        exitPermId: "EXPIRATION",
        exitTime: entry.trade.exitTime,
        kind: "expiration",
        permId: entry.row.perm_id,
        status: entry.trade.status,
        tradeId: entry.trade.id,
        note: "Synthetic expiration settlement from entries.csv.",
      });
      if (Math.abs(delta) > normalizedTolerance) {
        issues.push(`Expiration trade ${entry.trade.id} differs by ${formatCurrency(delta)}.`);
      }
    } else if (entry.trade.exitPrice === null || entry.trade.status === "Open") {
      diagnostics.push({
        archiveTruthPnl: 0,
        dailyReviewPnl: roundCurrency(entry.trade.pnl),
        delta: roundCurrency(entry.trade.pnl),
        entrySequence: entry.row.entry_sequence,
        entryTime: entry.trade.entryTime,
        exitTime: entry.trade.exitTime,
        kind: "open",
        permId: entry.row.perm_id,
        status: entry.trade.status,
        tradeId: entry.trade.id,
        note: "Open trade contributes zero realized audit PnL.",
      });
    }
  }

  for (const [permId, rawPnl] of rawRealizedByPerm) {
    if (referencedExitPerms.has(permId) || Math.abs(rawPnl) <= normalizedTolerance) {
      continue;
    }
    issues.push(`Raw realized PnL ${formatCurrency(rawPnl)} for perm ${permId} is not referenced by any Daily Review SPX spread entry.`);
    diagnostics.push({
      archiveTruthPnl: roundCurrency(rawPnl),
      dailyReviewPnl: 0,
      delta: roundCurrency(0 - rawPnl),
      exitPermId: permId,
      kind: "unmatched_raw",
      note: "Raw realized PnL exists without a matching Daily Review entry.",
    });
  }

  let closedArchivePnl = 0;
  for (const permId of referencedExitPerms) {
    const rawPnl = rawRealizedByPerm.get(permId);
    if (rawPnl === undefined) {
      issues.push(`No raw realized PnL found in fills.csv for exit perm ${permId}.`);
    } else {
      closedArchivePnl += rawPnl;
    }
  }

  const dailyReviewPnl = roundCurrency(entries.reduce((sum, entry) => sum + entry.trade.pnl, 0));
  const archiveTruthPnl = roundCurrency(closedArchivePnl + expirationArchivePnl);
  const delta = roundCurrency(dailyReviewPnl - archiveTruthPnl);
  if (Math.abs(delta) > normalizedTolerance) {
    issues.push(`Daily Review PnL differs from archive truth by ${formatCurrency(delta)}.`);
  }

  return {
    archiveTruthPnl,
    dailyReviewPnl,
    date,
    dayDir,
    delta,
    diagnostics,
    entryCount: entries.length,
    fillCount: fillRows.length,
    issues,
    status: issues.length || Math.abs(delta) > normalizedTolerance ? "fail" : "pass",
    tolerance: normalizedTolerance,
  };
}

export function formatPnlAuditMarkdown(result: PnlAuditRunResult): string {
  const lines = [
    "# Daily Review PnL Audit",
    "",
    `Generated: ${result.generatedAt}`,
    `Root: ${result.root}`,
    `Tolerance: ${formatCurrency(result.tolerance)}`,
    `Status: ${result.status}`,
    "",
    "| Date | Status | Entries | Fills | Daily Review | Archive Truth | Delta | Issues |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const item of result.results) {
    lines.push(
      `| ${item.date} | ${item.status} | ${item.entryCount} | ${item.fillCount} | ${formatCurrency(item.dailyReviewPnl)} | ${formatCurrency(item.archiveTruthPnl)} | ${formatCurrency(item.delta)} | ${item.issues.length ? item.issues.join("<br>") : ""} |`,
    );
  }

  const failures = result.results.filter((item) => item.status === "fail");
  if (failures.length) {
    lines.push("", "## Failure Details");
    for (const failure of failures) {
      lines.push("", `### ${failure.date}`, "");
      for (const diagnostic of failure.diagnostics.filter((item) => Math.abs(item.delta) > failure.tolerance || item.kind === "unmatched_raw")) {
        lines.push(
          `- ${diagnostic.kind} ${diagnostic.exitPermId ?? diagnostic.tradeId ?? ""}: Daily Review ${formatCurrency(diagnostic.dailyReviewPnl)}, archive ${formatCurrency(diagnostic.archiveTruthPnl)}, delta ${formatCurrency(diagnostic.delta)}. ${diagnostic.note}`,
        );
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

async function auditDates(root: string, options: PnlAuditOptions): Promise<string[]> {
  if (options.date) {
    validateDate(options.date, "--date");
    return [options.date];
  }
  if (options.from) {
    validateDate(options.from, "--from");
  }
  if (options.to) {
    validateDate(options.to, "--to");
  }
  if (!(await pathExists(root))) {
    throw new Error(`PnL audit root not found: ${root}`);
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && DATE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .filter((date) => (!options.from || date >= options.from) && (!options.to || date <= options.to))
    .sort();
}

function emptyDateResult(input: {
  date: string;
  dayDir: string;
  issue: string;
  status: PnlAuditStatus;
  tolerance: number;
}): PnlAuditDateResult {
  return {
    archiveTruthPnl: 0,
    dailyReviewPnl: 0,
    date: input.date,
    dayDir: input.dayDir,
    delta: 0,
    diagnostics: [],
    entryCount: 0,
    fillCount: 0,
    issues: [input.issue],
    status: input.status,
    tolerance: input.tolerance,
  };
}

function groupClosedEntriesByExitPerm(entries: EntryAuditRow[]): Array<{ entries: EntryAuditRow[]; exitPermId: string }> {
  const groups = new Map<string, EntryAuditRow[]>();
  for (const entry of entries) {
    const exitPermIds = exitPermIdList(entry.row.exit_perm_id);
    if (!exitPermIds.length || entry.trade.exitPrice === null || entry.trade.status === "Open") {
      continue;
    }
    for (const exitPermId of exitPermIds) {
      const group = groups.get(exitPermId) ?? [];
      group.push(entry);
      groups.set(exitPermId, group);
    }
  }
  return [...groups.entries()].map(([exitPermId, groupEntries]) => ({ entries: groupEntries, exitPermId }));
}

function exitPermIdList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "EXPIRATION");
}

function realizedPnlByPerm(rows: CsvRow[], date: string): Map<string, number> {
  const byPerm = new Map<string, number>();
  for (const row of rows) {
    if (!isSpxOptionFill(row, date)) {
      continue;
    }
    const permId = String(row.perm_id ?? "").trim();
    const realizedPnl = toNullableNumber(row.realized_pnl);
    if (!permId || realizedPnl === null) {
      continue;
    }
    byPerm.set(permId, (byPerm.get(permId) ?? 0) + realizedPnl);
  }
  return byPerm;
}

function isSpxOptionFill(row: CsvRow, date: string): boolean {
  const secType = String(row.sec_type ?? "").trim();
  const localSymbol = normalizeSymbol(row.local_symbol ?? "");
  const expiration = String(row.last_trade_date_or_contract_month ?? "");
  return secType === "OPT" && localSymbol.startsWith("SPXW ") && (!expiration || expiration === date.replaceAll("-", ""));
}

function isExpirationEntry(row: CsvRow): boolean {
  return String(row.exit_perm_id ?? "").trim() === "EXPIRATION";
}

function syntheticExpirationPnl(row: CsvRow): number {
  const contracts = Math.abs(toNumber(row.entry_quantity));
  const entryPrice = toNumber(row.entry_price);
  const exitPrice = firstFiniteNumber(row.expiration_price, row.exit_price, 0);
  const fees = toNumber(row.total_commission) + toNumber(row.exit_total_commission);
  return (exitPrice - entryPrice) * contracts * 100 - fees;
}

function firstExistingAiStuffRoot(cwd: string): string | null {
  const homeDesktopAiStuff = path.join(os.homedir(), "Desktop", "AI STUFF");
  if (syncPathExists(path.join(homeDesktopAiStuff, "IBKR Equity History Pull"))) {
    return homeDesktopAiStuff;
  }
  const parent = path.resolve(cwd, "..");
  if (syncPathExists(path.join(parent, "IBKR Equity History Pull"))) {
    return parent;
  }
  const grandparent = path.resolve(cwd, "..", "..");
  if (syncPathExists(path.join(grandparent, "IBKR Equity History Pull"))) {
    return grandparent;
  }
  return null;
}

function syncPathExists(target: string): boolean {
  try {
    return Boolean(target && statSync(target).isDirectory());
  } catch {
    return false;
  }
}

function validateDate(value: string, label: string): void {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
}

function normalizeSymbol(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTolerance(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_TOLERANCE);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TOLERANCE;
}

function firstFiniteNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = toNullableNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 0;
}

function toNullableNumber(value: unknown): number | null {
  const clean = String(value ?? "")
    .replace(/\((.*)\)/, "-$1")
    .replace(/[$,%]/g, "")
    .replace(/,/g, "")
    .trim();
  if (!clean || clean === "-") {
    return null;
  }
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown, fallback = 0): number {
  return toNullableNumber(value) ?? fallback;
}

function roundCurrency(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * (Math.round((Math.abs(value) + 1e-9) * 100) / 100);
}

function formatCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
