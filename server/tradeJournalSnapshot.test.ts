import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeTradeJournalSnapshot } from "./tradeJournalSnapshot";

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
});
