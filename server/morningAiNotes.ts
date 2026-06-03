import fs from "node:fs/promises";
import path from "node:path";
import type { MorningAiNotesBlock, MorningAiNotesPayload } from "../shared/types.ts";

type JsonRecord = Record<string, unknown>;

const MAX_BULLETS = 5;

function aiNotesPath(): string {
  return process.env.RUBICON_MORNING_AI_NOTES_PATH || path.join(process.cwd(), "data", "morning-ai-notes.json");
}

function journalSnapshotPath(): string {
  return process.env.RUBICON_JOURNAL_SNAPSHOT_PATH || path.join(process.cwd(), "data", "trade-journal.json");
}

function reviewNotesPath(): string {
  return process.env.REVIEW_NOTES_PATH || path.join(process.cwd(), "data", "review-notes.json");
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

async function readJson(target: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await fs.readFile(target, "utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

function validDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function safeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeBullets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((bullet) => safeText(bullet))
    .filter(Boolean)
    .slice(0, MAX_BULLETS);
}

function normalizeBlock(value: unknown, fallback: MorningAiNotesBlock): MorningAiNotesBlock {
  const record = asRecord(value);
  const bullets = safeBullets(record.bullets);
  return {
    available: record.available === true && bullets.length > 0,
    bullets: bullets.length ? bullets : fallback.bullets,
    dateRange: safeText(record.dateRange) || fallback.dateRange,
    label: safeText(record.label) || fallback.label,
  };
}

function normalizeAutomationPayload(value: JsonRecord, date: string): MorningAiNotesPayload | null {
  const payloadDate = validDate(value.date) ?? validDate(value.forDate) ?? date;
  const pending = pendingShell(date);
  const previousDay = normalizeBlock(value.previousDay, pending.previousDay);
  const previousWeek = normalizeBlock(value.previousWeek, pending.previousWeek);
  return {
    date: payloadDate,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : null,
    message:
      safeText(value.message) ||
      (payloadDate === date
        ? `Codex automation generated diary notes for ${date}. Each section is capped at ${MAX_BULLETS} bullets.`
        : `Latest Codex automation notes are for ${payloadDate}; selected Morning date is ${date}.`),
    previousDay,
    previousWeek,
    source: "codex_automation",
  };
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00-04:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function dateBetween(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function pendingShell(date: string): MorningAiNotesPayload {
  const previousDay = addDays(date, -1);
  return {
    date,
    generatedAt: null,
    message: "Codex automation has not generated AI diary notes for this Morning date yet.",
    previousDay: {
      available: false,
      bullets: ["Automation output pending. Rubicon will read data/morning-ai-notes.json when the Codex job writes it."],
      dateRange: previousDay,
      label: "Previous session",
    },
    previousWeek: {
      available: false,
      bullets: ["Automation output pending. The weekly section is generated from the saved journal and review-note snapshots."],
      dateRange: `${addDays(date, -7)} to ${previousDay}`,
      label: "Previous week",
    },
    source: "pending",
  };
}

function journalEntriesFromSnapshot(snapshot: JsonRecord | null): JsonRecord[] {
  const entries = asRecord(snapshot?.entries);
  return Object.values(entries).map(asRecord);
}

function reviewNoteDates(notes: JsonRecord | null): string[] {
  return Object.keys(asRecord(notes)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
}

async function buildPendingPayload(date: string, mismatchDate?: string): Promise<MorningAiNotesPayload> {
  const [journalSnapshot, reviewNotes] = await Promise.all([readJson(journalSnapshotPath()), readJson(reviewNotesPath())]);
  const journalEntries = journalEntriesFromSnapshot(journalSnapshot);
  const journalDates = journalEntries.map((entry) => validDate(entry.date)).filter((entryDate): entryDate is string => Boolean(entryDate));
  const allPriorDates = [...journalDates, ...reviewNoteDates(reviewNotes)].filter((entryDate) => entryDate < date).sort();
  const previousDay = allPriorDates.at(-1) ?? addDays(date, -1);
  const weekStart = addDays(date, -7);
  const weekEnd = addDays(date, -1);
  const previousDayEntries = journalEntries.filter((entry) => entry.date === previousDay);
  const weekEntries = journalEntries.filter((entry) => typeof entry.date === "string" && dateBetween(entry.date, weekStart, weekEnd));
  const notesRecord = asRecord(reviewNotes);
  const previousDayReview = asRecord(notesRecord[previousDay]);
  const weekReviewCount = Object.keys(notesRecord).filter((noteDate) => dateBetween(noteDate, weekStart, weekEnd)).length;
  const shell = pendingShell(date);
  return {
    ...shell,
    message: mismatchDate
      ? `Latest Codex automation notes are for ${mismatchDate}; waiting for a ${date} run.`
      : shell.message,
    previousDay: {
      available: false,
      bullets: [
        "Codex automation summary pending.",
        `${previousDayEntries.length} journal entr${previousDayEntries.length === 1 ? "y is" : "ies are"} staged for ${previousDay}.`,
        safeText(previousDayReview.note) ? "A Daily Review note is also staged for the previous session." : "No Daily Review note is staged for the previous session yet.",
      ],
      dateRange: previousDay,
      label: "Previous session",
    },
    previousWeek: {
      available: false,
      bullets: [
        "Codex automation weekly summary pending.",
        `${weekEntries.length} journal entr${weekEntries.length === 1 ? "y" : "ies"} and ${weekReviewCount} Daily Review note${weekReviewCount === 1 ? "" : "s"} are staged across the prior 7 days.`,
      ],
      dateRange: `${weekStart} to ${weekEnd}`,
      label: "Previous week",
    },
  };
}

export async function loadMorningAiNotes(date: string): Promise<MorningAiNotesPayload> {
  const automationOutput = await readJson(aiNotesPath());
  if (automationOutput) {
    const normalized = normalizeAutomationPayload(automationOutput, date);
    if (normalized) {
      return normalized;
    }
  }
  return buildPendingPayload(date);
}
