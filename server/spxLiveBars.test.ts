import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSpxBarsMarketWindow, loadSpxLiveBars } from "./spxLiveBars.ts";

const clock = (time: string, weekday: number) => ({ date: "2026-06-04", time, weekday });

describe("isSpxBarsMarketWindow", () => {
  it("opens during weekday RTH (with the small pre-open grace) and refuses outside it", () => {
    expect(isSpxBarsMarketWindow(clock("09:25", 4))).toBe(true);
    expect(isSpxBarsMarketWindow(clock("12:00", 4))).toBe(true);
    expect(isSpxBarsMarketWindow(clock("15:59", 4))).toBe(true);
    expect(isSpxBarsMarketWindow(clock("16:00", 4))).toBe(false); // at the close
    expect(isSpxBarsMarketWindow(clock("09:00", 4))).toBe(false); // pre-open
    expect(isSpxBarsMarketWindow(clock("12:00", 6))).toBe(false); // Saturday
    expect(isSpxBarsMarketWindow(clock("12:00", 0))).toBe(false); // Sunday
  });
});

describe("loadSpxLiveBars", () => {
  let appRoot: string;

  beforeEach(async () => {
    appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spx-live-bars-"));
    await fs.mkdir(path.join(appRoot, "data"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  async function writeBars(payload: unknown): Promise<void> {
    await fs.writeFile(path.join(appRoot, "data", "spx-live-bars.json"), JSON.stringify(payload), "utf8");
  }

  it("sanitises bars, drops malformed rows, sorts by time, and reports the latest label as asOf", async () => {
    await writeBars({
      generatedAt: "2026-06-04T14:00:00-04:00",
      session: "2026-06-04",
      source: "ibkr-live",
      live: true,
      barSize: "1 min",
      bars: [
        { time: 1749060120, timestampEt: "2026-06-04T09:42:00-04:00", label: "09:42", open: 7570, high: 7572, low: 7569, close: 7571 },
        { time: 1749060060, timestampEt: "2026-06-04T09:41:00-04:00", label: "09:41", open: 7568, high: 7571, low: 7567, close: 7570 }, // out of order
        { time: 1749060180, label: "09:43", open: "bad", high: 1, low: 1, close: 1 }, // bad open → dropped
      ],
    });

    const payload = await loadSpxLiveBars(appRoot);

    expect(payload.source).toBe("ibkr-live");
    expect(payload.live).toBe(true);
    expect(payload.bars.map((bar) => bar.label)).toEqual(["09:41", "09:42"]); // sorted, bad row dropped
    expect(payload.asOf).toBe("09:42");
  });

  it("returns an explained empty payload when the feed file is missing", async () => {
    const payload = await loadSpxLiveBars(appRoot);
    expect(payload.bars).toEqual([]);
    expect(payload.asOf).toBeNull();
    expect(payload.source).toBe("none");
    expect(payload.note).toMatch(/No live SPX bar feed/);
  });
});
