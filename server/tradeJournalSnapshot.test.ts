import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mergeTradeJournalSnapshot, writeTradeJournalSnapshot } from "./tradeJournalSnapshot";

const ORIGINAL_JOURNAL_SNAPSHOT_PATH = process.env.RUBICON_JOURNAL_SNAPSHOT_PATH;

afterEach(() => {
  if (ORIGINAL_JOURNAL_SNAPSHOT_PATH === undefined) {
    delete process.env.RUBICON_JOURNAL_SNAPSHOT_PATH;
  } else {
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = ORIGINAL_JOURNAL_SNAPSHOT_PATH;
  }
});

describe("trade journal snapshot", () => {
  it("persists sanitized four-aspect checklist marks", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-journal-snapshot-"));
    const snapshotPath = path.join(tempDir, "trade-journal.json");
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = snapshotPath;

    await writeTradeJournalSnapshot({
      T1: {
        tradeId: "T1",
        date: "2026-05-29",
        aspectChecks: {
          entryStructure: true,
          priceAction: "yes",
          volumeNode: true,
          orderflow: false,
          ignored: true,
        },
      },
    });

    const stored = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      entries: Record<string, { aspectChecks: Record<string, boolean> }>;
    };

    expect(stored.entries.T1.aspectChecks).toEqual({
      entryStructure: true,
      priceAction: false,
      volumeNode: true,
      orderflow: false,
    });
  });

  it("merge keeps entries a stale client never loaded", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-journal-merge-"));
    const snapshotPath = path.join(tempDir, "trade-journal.json");
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = snapshotPath;

    await writeTradeJournalSnapshot({
      A: { tradeId: "A", lesson: "keep me", updatedAt: "2026-06-09T10:00:00.000Z" },
      B: { tradeId: "B", lesson: "old B", updatedAt: "2026-06-09T10:00:00.000Z" },
    });

    // A stale tab that only ever loaded B sends a payload without A.
    const result = await mergeTradeJournalSnapshot({
      B: { tradeId: "B", lesson: "new B", updatedAt: "2026-06-09T11:00:00.000Z" },
    });

    const stored = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      entries: Record<string, { lesson: string }>;
    };
    expect(result.count).toBe(2);
    expect(stored.entries.A.lesson).toBe("keep me");
    expect(stored.entries.B.lesson).toBe("new B");
  });

  it("merge refuses to roll an entry back to an older updatedAt", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-journal-merge-"));
    const snapshotPath = path.join(tempDir, "trade-journal.json");
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = snapshotPath;

    await writeTradeJournalSnapshot({
      T1: { tradeId: "T1", lesson: "newer save", updatedAt: "2026-06-09T15:00:00.000Z" },
    });

    await mergeTradeJournalSnapshot({
      T1: { tradeId: "T1", lesson: "stale tab edit", updatedAt: "2026-06-09T09:00:00.000Z" },
    });

    const stored = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      entries: Record<string, { lesson: string }>;
    };
    expect(stored.entries.T1.lesson).toBe("newer save");
  });

  it("merge applies a newer incoming entry and sanitizes it", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-journal-merge-"));
    const snapshotPath = path.join(tempDir, "trade-journal.json");
    process.env.RUBICON_JOURNAL_SNAPSHOT_PATH = snapshotPath;

    await writeTradeJournalSnapshot({
      T1: { tradeId: "T1", lesson: "before", updatedAt: "2026-06-09T09:00:00.000Z" },
    });

    await mergeTradeJournalSnapshot({
      T1: {
        tradeId: "T1",
        lesson: "after",
        updatedAt: "2026-06-09T16:00:00.000Z",
        aspectChecks: { entryStructure: "yes", priceAction: true, volumeNode: false, orderflow: false },
      },
    });

    const stored = JSON.parse(await fs.readFile(snapshotPath, "utf8")) as {
      entries: Record<string, { lesson: string; aspectChecks: Record<string, boolean> }>;
    };
    expect(stored.entries.T1.lesson).toBe("after");
    expect(stored.entries.T1.aspectChecks).toEqual({
      entryStructure: false,
      priceAction: true,
      volumeNode: false,
      orderflow: false,
    });
  });
});
