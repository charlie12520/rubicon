import type { TradeJournalSnapshotSaveResult } from "../shared/types.ts";
import { readJson, writeJsonAtomic } from "./jsonStore.ts";
import path from "node:path";

const MAX_TEXT_LENGTH = 4000;
const JOURNAL_ASPECT_KEYS = ["entryStructure", "priceAction", "volumeNode", "orderflow"] as const;

function journalSnapshotPath(): string {
  return process.env.RUBICON_JOURNAL_SNAPSHOT_PATH || path.join(process.cwd(), "data", "trade-journal.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_LENGTH) : "";
}

function safeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
}

function safeScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 3;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function safeAspectChecks(value: unknown): Record<(typeof JOURNAL_ASPECT_KEYS)[number], boolean> {
  const record = asRecord(value);
  return Object.fromEntries(
    JOURNAL_ASPECT_KEYS.map((key) => [key, record[key] === true]),
  ) as Record<(typeof JOURNAL_ASPECT_KEYS)[number], boolean>;
}

function sanitizeEntry(tradeId: string, value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  const normalizedTradeId = safeText(record.tradeId) || tradeId;
  if (!normalizedTradeId) {
    return null;
  }

  return {
    tradeId: normalizedTradeId.slice(0, 180),
    date: safeText(record.date).slice(0, 10),
    setup: safeText(record.setup),
    thesis: safeText(record.thesis),
    execution: safeText(record.execution),
    emotion: safeText(record.emotion).slice(0, 32),
    mistake: safeText(record.mistake),
    lesson: safeText(record.lesson),
    grade: safeText(record.grade).slice(0, 2),
    processScore: safeScore(record.processScore),
    tags: safeTags(record.tags),
    aspectChecks: safeAspectChecks(record.aspectChecks),
    followUp: record.followUp === true,
    status: safeText(record.status).slice(0, 24),
    updatedAt: safeText(record.updatedAt) || null,
  };
}

function sanitizeEntries(value: unknown): Record<string, Record<string, unknown>> {
  const rawEntries = asRecord(value);
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [tradeId, entry] of Object.entries(rawEntries)) {
    const sanitized = sanitizeEntry(tradeId, entry);
    if (sanitized) {
      entries[String(sanitized.tradeId)] = sanitized;
    }
  }
  return entries;
}

export async function writeTradeJournalSnapshot(value: unknown): Promise<TradeJournalSnapshotSaveResult> {
  const entries = sanitizeEntries(value);
  const target = journalSnapshotPath();
  await writeJsonAtomic(target, { generatedAt: new Date().toISOString(), entries });
  return {
    count: Object.keys(entries).length,
    generatedAt: new Date().toISOString(),
    message: `Saved ${Object.keys(entries).length} journal entries for Codex automation.`,
    ok: true,
  };
}

function entryUpdatedAtMs(entry: Record<string, unknown> | undefined): number | null {
  const raw = entry?.updatedAt;
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function mergeTradeJournalSnapshot(value: unknown): Promise<TradeJournalSnapshotSaveResult> {
  // The client pushes its ENTIRE journal map on every change, seeded from that
  // browser profile's localStorage — so a stale tab (or an empty profile)
  // replacing the whole file could silently drop entries. Merge by tradeId
  // instead: entries absent from the incoming payload survive, and an entry
  // only updates when the incoming copy is not older than what's on disk.
  // (`writeTradeJournalSnapshot` above stays as the explicit full-replace
  // maintenance primitive.)
  const incoming = sanitizeEntries(value);
  const target = journalSnapshotPath();
  const existingSnapshot = await readJson<{ entries?: unknown }>(target, {});
  const existing = sanitizeEntries(existingSnapshot.entries);

  const merged: Record<string, Record<string, unknown>> = { ...existing };
  let applied = 0;
  let keptNewerExisting = 0;
  for (const [tradeId, entry] of Object.entries(incoming)) {
    const existingMs = entryUpdatedAtMs(existing[tradeId]);
    const incomingMs = entryUpdatedAtMs(entry);
    if (existing[tradeId] && existingMs !== null && incomingMs !== null && existingMs > incomingMs) {
      keptNewerExisting += 1;
      continue;
    }
    merged[tradeId] = entry;
    applied += 1;
  }

  await writeJsonAtomic(target, { generatedAt: new Date().toISOString(), entries: merged });
  const count = Object.keys(merged).length;
  const keptNote = keptNewerExisting > 0 ? `, kept ${keptNewerExisting} newer existing` : "";
  return {
    count,
    generatedAt: new Date().toISOString(),
    message: `Merged ${applied} journal entries (${count} total${keptNote}).`,
    ok: true,
  };
}
