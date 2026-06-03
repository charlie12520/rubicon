import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeGodelBridgeRequest,
  godelBridgeBookmarklet,
  getGodelAlertBridgeStatus,
  ingestGodelBridgeAlert,
  setGodelBridgeCorsHeaders,
} from "./godelAlertBridge.ts";

const ORIGINAL_CAPTURE = process.env.RUBICON_GODEL_BRIDGE_CAPTURE_PATH;
const ORIGINAL_STATUS = process.env.RUBICON_GODEL_BRIDGE_STATUS_PATH;
const ORIGINAL_TOKEN = process.env.RUBICON_GODEL_BRIDGE_TOKEN;

describe("Godel DOM bridge ingestion", () => {
  afterEach(() => {
    restoreEnv("RUBICON_GODEL_BRIDGE_CAPTURE_PATH", ORIGINAL_CAPTURE);
    restoreEnv("RUBICON_GODEL_BRIDGE_STATUS_PATH", ORIGINAL_STATUS);
    restoreEnv("RUBICON_GODEL_BRIDGE_TOKEN", ORIGINAL_TOKEN);
  });

  it("rejects numeric ladder text and stores bottom-right headline alerts", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-godel-bridge-"));
    const capturePath = path.join(tempDir, "godel-live-news.json");
    const statusPath = path.join(tempDir, "bridge-status.json");
    process.env.RUBICON_GODEL_BRIDGE_CAPTURE_PATH = capturePath;
    process.env.RUBICON_GODEL_BRIDGE_STATUS_PATH = statusPath;

    await ingestGodelBridgeAlert({
      captureKind: "bottom-right-red-alert",
      sourceUrl: "https://app.godelterminal.com/",
      text: "2945 2747 1878 1270 2515 7619.75 7619.50 7619.25 7619.00 7618.75",
    });

    await expect(fs.stat(capturePath)).rejects.toThrow();
    const rejectedStatus = JSON.parse(await fs.readFile(statusPath, "utf8")) as { lastRejected?: { reason?: string } };
    expect(rejectedStatus.lastRejected?.reason).not.toBe("ok");

    const broadStatus = await ingestGodelBridgeAlert({
      sourceUrl: "https://app.godelterminal.com/",
      text: "Fed's Williams says inflation progress remains uneven this quarter",
    });
    expect(broadStatus.validCount).toBe(0);
    const broadRejectedStatus = JSON.parse(await fs.readFile(statusPath, "utf8")) as { lastRejected?: { reason?: string } };
    expect(broadRejectedStatus.lastRejected?.reason).toBe("not-bottom-right-alert");

    const status = await ingestGodelBridgeAlert({
      captureKind: "bottom-right-red-alert",
      sourceUrl: "https://app.godelterminal.com/",
      text: "Fed's Williams says inflation progress remains uneven this quarter",
    });

    expect(status.validCount).toBe(1);
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as { news: Array<{ captureKind?: string; headline: string; provider?: string }> };
    expect(capture.news[0].captureKind).toBe("bottom-right-red-alert");
    expect(capture.news[0].provider).toBe("Godel red alert");
    expect(capture.news[0].headline).toBe("Fed's Williams says inflation progress remains uneven this quarter");
  });

  it("stores manual pasted Godel alerts as a fallback surface", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-godel-bridge-"));
    const capturePath = path.join(tempDir, "godel-live-news.json");
    const statusPath = path.join(tempDir, "bridge-status.json");
    process.env.RUBICON_GODEL_BRIDGE_CAPTURE_PATH = capturePath;
    process.env.RUBICON_GODEL_BRIDGE_STATUS_PATH = statusPath;

    const status = await ingestGodelBridgeAlert({
      sourceUrl: "manual-paste:godel-setup",
      text: "Godel red alert says liquidity conditions tightened into the close",
    });

    expect(status.validCount).toBe(1);
    const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as { news: Array<{ captureKind?: string; provider?: string }> };
    expect(capture.news[0].captureKind).toBe("manual-paste");
    expect(capture.news[0].provider).toBe("Godel manual alert");
  });

  it("ignores stale broad DOM bridge rows that lack the alert capture marker", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rubicon-godel-bridge-"));
    const capturePath = path.join(tempDir, "godel-live-news.json");
    const statusPath = path.join(tempDir, "bridge-status.json");
    process.env.RUBICON_GODEL_BRIDGE_CAPTURE_PATH = capturePath;
    process.env.RUBICON_GODEL_BRIDGE_STATUS_PATH = statusPath;
    await fs.writeFile(
      capturePath,
      JSON.stringify({
        news: [
          {
            headline: "Broad chat row that should not enter red alert tape",
            id: "old-chat",
            provider: "Godel DOM bridge",
            publishedAt: "2026-06-02T20:00:00.000Z",
            sourceUrl: "https://app.godelterminal.com/",
            url: "https://app.godelterminal.com/",
          },
        ],
      }),
      "utf8",
    );

    const status = await getGodelAlertBridgeStatus();

    expect(status.validCount).toBe(0);
  });

  it("does not emit wildcard CORS headers for disallowed bridge origins", () => {
    const allowedHeaders: Record<string, string> = {};
    setGodelBridgeCorsHeaders("https://app.godelterminal.com", {
      setHeader: (name, value) => {
        allowedHeaders[name] = value;
      },
    });
    expect(allowedHeaders["Access-Control-Allow-Origin"]).toBe("https://app.godelterminal.com");
    expect(allowedHeaders["Access-Control-Allow-Headers"]).toContain("X-Rubicon-Bridge-Token");

    const rejectedHeaders: Record<string, string> = {};
    setGodelBridgeCorsHeaders("https://evil.example.com", {
      setHeader: (name, value) => {
        rejectedHeaders[name] = value;
      },
    });
    expect(rejectedHeaders["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("rejects disallowed origins and requires the lightweight bridge token", () => {
    process.env.RUBICON_GODEL_BRIDGE_TOKEN = "bridge-secret";

    expect(
      authorizeGodelBridgeRequest({
        body: { text: "Fed says inflation remains uneven this quarter" },
        origin: "https://evil.example.com",
        token: "bridge-secret",
      }),
    ).toMatchObject({ ok: false, status: 403 });

    expect(
      authorizeGodelBridgeRequest({
        body: { text: "Fed says inflation remains uneven this quarter" },
        origin: "https://app.godelterminal.com",
        token: "wrong",
      }),
    ).toMatchObject({ ok: false, status: 401 });

    expect(
      authorizeGodelBridgeRequest({
        body: { bridgeToken: "bridge-secret", text: "Fed says inflation remains uneven this quarter" },
        origin: "https://app.godelterminal.com",
      }),
    ).toMatchObject({ ok: true });
  });

  it("embeds the bridge token in the served bookmarklet", () => {
    process.env.RUBICON_GODEL_BRIDGE_TOKEN = "bridge-secret";

    const decoded = decodeURIComponent(godelBridgeBookmarklet().replace(/^javascript:/, ""));

    expect(decoded).toContain('"X-Rubicon-Bridge-Token"');
    expect(decoded).toContain("bridgeToken");
    expect(decoded).toContain("bridge-secret");
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
