import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMorningAiNotes } from "./morningAiNotes.ts";

const originalAiNotesPath = process.env.RUBICON_MORNING_AI_NOTES_PATH;
const originalJournalPath = process.env.RUBICON_JOURNAL_SNAPSHOT_PATH;
const originalReviewNotesPath = process.env.REVIEW_NOTES_PATH;

afterEach(() => {
  restoreEnv("RUBICON_MORNING_AI_NOTES_PATH", originalAiNotesPath);
  restoreEnv("RUBICON_JOURNAL_SNAPSHOT_PATH", originalJournalPath);
  restoreEnv("REVIEW_NOTES_PATH", originalReviewNotesPath);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("morning AI notes", () => {
  it("loads Codex automation notes and caps bullets per section", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-ai-notes-"));
    const aiNotesPath = path.join(tempDir, "morning-ai-notes.json");
    process.env.RUBICON_MORNING_AI_NOTES_PATH = aiNotesPath;
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = path.join(tempDir, "trade-journal.json");
    process.env.REVIEW_NOTES_PATH = path.join(tempDir, "review-notes.json");
    await fs.writeFile(
      aiNotesPath,
      JSON.stringify({
        date: "2026-05-31",
        generatedAt: "2026-05-31T12:20:00.000Z",
        previousDay: {
          available: true,
          bullets: ["one", "two", "three", "four", "five", "six"],
          dateRange: "2026-05-29",
          label: "Previous session",
        },
        previousWeek: {
          available: true,
          bullets: ["week"],
          dateRange: "2026-05-25 to 2026-05-29",
          label: "Previous week",
        },
      }),
      "utf8",
    );

    const notes = await loadMorningAiNotes("2026-05-31");

    expect(notes.source).toBe("codex_automation");
    expect(notes.previousDay.bullets).toEqual(["one", "two", "three", "four", "five"]);
    expect(notes.previousWeek.bullets).toEqual(["week"]);
  });

  it("returns pending staged-data counts when automation output is missing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-ai-notes-"));
    const journalPath = path.join(tempDir, "trade-journal.json");
    const reviewNotesPath = path.join(tempDir, "review-notes.json");
    process.env.RUBICON_MORNING_AI_NOTES_PATH = path.join(tempDir, "missing.json");
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = journalPath;
    process.env.REVIEW_NOTES_PATH = reviewNotesPath;
    await fs.writeFile(
      journalPath,
      JSON.stringify({
        entries: {
          t1: { date: "2026-05-29", tradeId: "t1", status: "reviewed" },
          t2: { date: "2026-05-28", tradeId: "t2", status: "draft" },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      reviewNotesPath,
      JSON.stringify({
        "2026-05-29": { note: "Avoid chasing.", tradeFlags: {}, updatedAt: "2026-05-29T22:00:00.000Z" },
      }),
      "utf8",
    );

    const notes = await loadMorningAiNotes("2026-05-31");

    expect(notes.source).toBe("pending");
    expect(notes.previousDay.dateRange).toBe("2026-05-29");
    expect(notes.previousDay.bullets.join(" ")).toContain("1 journal entry");
    expect(notes.previousWeek.bullets.join(" ")).toContain("2 journal entries");
  });
});
