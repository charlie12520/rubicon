import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Real temp dirs (no fs mocking): loadLiveSpreadSpeed reads
// <appRoot>/data/spx-0dte-chain.json and runs the real buildFrame, so these
// exercise the genuine JSON -> frame path.
let appRoot = "";

beforeEach(async () => {
  // Short-circuit the venv-python existsSync probe at module load.
  process.env.SPREAD_SPEED_LIVE_PYTHON = "python";
  appRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "rubicon-live-ss-"));
  await fsp.mkdir(path.join(appRoot, "data"), { recursive: true });
});

afterEach(async () => {
  if (appRoot) {
    await fsp.rm(appRoot, { recursive: true, force: true });
  }
});

async function writeChain(payload: unknown): Promise<void> {
  await fsp.writeFile(path.join(appRoot, "data", "spx-0dte-chain.json"), JSON.stringify(payload), "utf8");
}

describe("loadLiveSpreadSpeed", () => {
  it("returns unavailable (but live-tagged) when the snapshot file is missing", async () => {
    const { loadLiveSpreadSpeed } = await import("./spreadSpeedLive.ts");
    const payload = await loadLiveSpreadSpeed(appRoot);
    expect(payload.available).toBe(false);
    expect(payload.live).toBe(true);
    expect(payload.note).toMatch(/No live SPXW 0DTE feed/i);
  });

  it("builds a single live frame from a fresh snapshot", async () => {
    const { loadLiveSpreadSpeed } = await import("./spreadSpeedLive.ts");
    await writeChain({
      session: "2026-06-05",
      spot: 5900,
      label: "10:14",
      asOf: new Date().toISOString(),
      rows: [
        { strike: 5900, right: "C", close: 15 },
        { strike: 5900, right: "P", close: 15 },
        { strike: 5800, right: "P", close: 3 },
        { strike: 5795, right: "P", close: 2.6 },
        { strike: 6000, right: "C", close: 3 },
        { strike: 6005, right: "C", close: 2.6 },
      ],
    });

    const payload = await loadLiveSpreadSpeed(appRoot);

    expect(payload.available).toBe(true);
    expect(payload.live).toBe(true);
    expect(payload.date).toBe("2026-06-05");
    expect(payload.frames).toHaveLength(1);
    expect(payload.frames[0].label).toBe("10:14");
    expect(payload.frames[0].spot).toBe(5900);
  });

  it("treats a stale snapshot as unavailable", async () => {
    const { loadLiveSpreadSpeed } = await import("./spreadSpeedLive.ts");
    await writeChain({
      session: "2026-06-05",
      spot: 5900,
      label: "10:14",
      asOf: "2020-01-01T00:00:00.000Z",
      rows: [
        { strike: 5900, right: "C", close: 15 },
        { strike: 5900, right: "P", close: 15 },
      ],
    });

    const payload = await loadLiveSpreadSpeed(appRoot);

    expect(payload.available).toBe(false);
    expect(payload.note).toMatch(/stale/i);
  });

  it("is unavailable when spot or option rows are missing", async () => {
    const { loadLiveSpreadSpeed } = await import("./spreadSpeedLive.ts");
    await writeChain({ session: "2026-06-05", spot: null, label: "10:14", asOf: new Date().toISOString(), rows: [] });

    const payload = await loadLiveSpreadSpeed(appRoot);

    expect(payload.available).toBe(false);
    expect(payload.note).toMatch(/no usable SPX spot/i);
  });
});
