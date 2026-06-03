import { describe, expect, it } from "vitest";
import type { DailySummary, DailySyncStatusResult, SourceHealth } from "../shared/types";
import { buildDailyPullChecklist } from "./dailyPullChecklist";

describe("daily pull checklist", () => {
  it("turns a selected-date pull into required operator steps with warning hover text", () => {
    const checklist = buildDailyPullChecklist({
      dailySyncStatus: {
        generatedAt: "2026-05-29T22:12:00.000Z",
        latestSummary: { date: "2026-05-29", entryCount: 19, fillCount: 136, path: "daily_sync_summary.json", spreadCount: 24, status: "partial" },
        message: "Daily SPX/IBKR sync completed.",
        ok: true,
        state: "completed",
        targetPlan: {
          afterCutoff: true,
          cutoffTimeEt: "16:25",
          estimatedTargetDate: "2026-05-29",
          mode: "auto",
          note: "Auto targets today.",
          nowEt: "2026-05-29 18:12 ET",
          requestedDate: "auto",
        },
      },
      latestTradeDate: "2026-05-29",
      selectedDate: "2026-05-29",
      sourceHealth: sources(),
      summary: summary({
        ibkrEndpointConnectedCount: 1,
        ibkrEndpointExpectedCount: 2,
        issues: [
          { detail: "10 no-data responses across 4 far OTM contracts.", severity: "warning", stage: "pull", title: "Expected HMDS no-data responses" },
          { detail: "127.0.0.1:7496 returned fills; 127.0.0.1:4001 was only a fallback endpoint.", severity: "info", stage: "pull", title: "Secondary IBKR endpoint did not connect" },
          { detail: "Open interest status partial; 112 / 120 contracts returned rows.", severity: "warning", stage: "pull", title: "Open interest pull not fully clean" },
        ],
        issueCount: 2,
        optionIntradayStatus: "partial",
      }),
      today: "2026-05-29",
      tradeCount: 9,
    });

    expect(checklist.steps.map((step) => step.action)).toContain("Run Daily Sync after the session is ready");
    expect(checklist.steps.map((step) => step.action)).toContain("Pull SPX intraday 5-second bars in New York time");
    expect(checklist.steps.map((step) => step.action)).toContain("Pull 5-second intraday bars for every traded option contract");
    expect(checklist.steps.map((step) => step.action)).toContain("Pull 1-minute bars for each stock/index underlying tied to option trades");
    expect(checklist.steps.map((step) => step.action)).not.toContain("Refresh or confirm the IBKR wallet snapshot");
    expect(checklist.warningCount).toBeGreaterThan(0);
    expect(checklist.steps.find((step) => step.id === "option-intraday")?.warnings.join(" ")).toContain("far OTM contracts");
    expect(checklist.steps.find((step) => step.id === "open-interest")?.warnings.join(" ")).toContain("112 / 120");
    expect(checklist.steps.find((step) => step.id === "upload")?.status).toBe("complete");
    expect(checklist.blockingCount).toBe(0);
    expect(checklist.coreReadyCount).toBe(checklist.coreItemCount);
    expect(checklist.readinessLabel).toBe("Ready");
    expect(checklist.coverageItems.find((item) => item.id === "option-bars")).toMatchObject({
      expected: 583200,
      missing: 87480,
      pulled: 495720,
      readinessLabel: "Usable breadth",
      status: "complete",
    });
    expect(checklist.coverageItems.find((item) => item.id === "spread-marks")).toMatchObject({
      missing: 1944,
      readinessLabel: "Replay ready",
      status: "complete",
    });
    expect(checklist.coverageItems.find((item) => item.id === "open-interest")).toMatchObject({
      missing: 8,
      readinessLabel: "OI usable",
      status: "complete",
    });
    expect(checklist.coverageItems.find((item) => item.id === "underlying-bars")).toMatchObject({
      expected: 2340,
      missing: 0,
      pulled: 2340,
      status: "complete",
    });
    expect(checklist.coverageItems.find((item) => item.id === "execution-endpoints")).toMatchObject({
      expected: 1,
      missing: 0,
      pulled: 1,
      coveragePct: 100,
      readinessLabel: "Endpoint ready",
      status: "complete",
    });
  });

  it("notes failures when required pull or upload artifacts are missing", () => {
    const checklist = buildDailyPullChecklist({
      selectedDate: "2026-05-30",
      sourceHealth: sources([{ label: "Replay market data", status: "missing", detail: "No replay folder." }]),
      summary: summary({
        entryCount: 0,
        optionIntradayStatus: "missing",
        payloadRows: 0,
        spxIntradayRowCount: 0,
        spxStatus: "missing",
        tradeStatus: "missing",
        underlyingIntradayRowCount: 0,
        underlyingIntradayStatus: "missing",
        uploadStatus: "missing_payload",
        uploadTabCount: 0,
      }),
      tradeCount: 0,
    });

    expect(checklist.failedCount).toBeGreaterThanOrEqual(5);
    expect(checklist.steps.find((step) => step.id === "trade-import")?.failures.join(" ")).toContain("IBKR trade status is missing");
    expect(checklist.steps.find((step) => step.id === "underlying-intraday")?.failures.join(" ")).toContain("Connected underlying 1m status is missing");
    expect(checklist.steps.find((step) => step.id === "payload")?.failures.join(" ")).toContain("payload is missing");
    expect(checklist.steps.find((step) => step.id === "source-refresh")?.failures.join(" ")).toContain("Replay market data");
    expect(checklist.coverageItems.find((item) => item.id === "spx-bars")?.missing).toBe(4680);
    expect(checklist.coverageItems.find((item) => item.id === "underlying-bars")).toMatchObject({
      expected: 2340,
      missing: 2340,
      pulled: 0,
      status: "failed",
    });
  });

  it("omits IBKR wallet source health from Daily Pull checks", () => {
    const checklist = buildDailyPullChecklist({
      selectedDate: "2026-05-29",
      sourceHealth: sources([{ detail: "Wallet warning should stay hidden.", label: "IBKR wallet", status: "warning" }]),
      summary: summary(),
      tradeCount: 9,
    });

    const renderedText = [
      ...checklist.steps.flatMap((step) => [step.action, step.evidence, ...step.failures, ...step.warnings, ...step.notes]),
      ...checklist.coverageItems.flatMap((item) => [item.label, item.basis, ...item.failures, ...item.warnings, ...item.notes]),
    ].join(" ");

    expect(renderedText).not.toMatch(/IBKR wallet/i);
    expect(renderedText).not.toContain("Wallet warning should stay hidden.");
    expect(checklist.steps.some((step) => step.id === "wallet")).toBe(false);
  });

  it("reflects live sync step completions in Daily Pull before final summary import", () => {
    const checklist = buildDailyPullChecklist({
      dailySyncStatus: syncStatus({
        steps: [
          {
            id: "core-sync",
            label: "Core SPX/IBKR sync",
            status: "complete",
            detail: "Local SPX and IBKR pull completed.",
          },
          {
            id: "sheet-payload",
            label: "Sheet payload",
            status: "complete",
            detail: "Payload staged for 2026-06-01 with 11 tabs.",
          },
          {
            id: "raw-workbook",
            label: "Raw upload workbook",
            status: "complete",
            detail: "Workbook rebuilt: spx_daily_upload_2026-06-01.xlsx",
          },
        ],
      }),
      latestTradeDate: "2026-06-01",
      selectedDate: "2026-06-01",
      sourceHealth: sources(),
      summary: null,
      today: "2026-06-01",
      tradeCount: 0,
    });

    expect(checklist.steps.find((step) => step.id === "sync-run")).toMatchObject({
      status: "complete",
    });
    expect(checklist.steps.find((step) => step.id === "payload")).toMatchObject({
      status: "complete",
    });
    expect(checklist.steps.find((step) => step.id === "raw-workbook")).toMatchObject({
      status: "complete",
    });
    expect(checklist.coverageItems.find((item) => item.id === "payload-tabs")).toMatchObject({
      pulled: 1,
      status: "complete",
    });
    expect(checklist.coverageItems.find((item) => item.id === "raw-workbook")).toMatchObject({
      pulled: 1,
      status: "complete",
    });
  });

  it("does not use stale wrapper steps to certify another selected date", () => {
    const checklist = buildDailyPullChecklist({
      dailySyncStatus: syncStatus({
        latestSummary: { date: "2026-06-02", entryCount: 32, fillCount: 121, path: "daily_sync_summary.json", spreadCount: 38, status: "partial" },
        state: "completed",
        steps: [
          {
            id: "sheet-payload",
            label: "Sheet payload",
            status: "complete",
            detail: "Payload staged for 2026-06-02 with 11 tabs.",
          },
          {
            id: "raw-workbook",
            label: "Raw upload workbook",
            status: "complete",
            detail: "Workbook rebuilt: spx_daily_upload_2026-06-02.xlsx",
          },
        ],
        targetPlan: {
          afterCutoff: true,
          cutoffTimeEt: "16:25",
          estimatedTargetDate: "2026-06-02",
          mode: "auto",
          note: "Auto targets yesterday.",
          nowEt: "2026-06-03 09:00 ET",
          requestedDate: "auto",
        },
      }),
      selectedDate: "2026-06-03",
      sourceHealth: sources(),
      summary: null,
      today: "2026-06-03",
      tradeCount: 0,
    });

    expect(checklist.steps.find((step) => step.id === "payload")).toMatchObject({
      status: "failed",
    });
    expect(checklist.steps.find((step) => step.id === "raw-workbook")).toMatchObject({
      status: "warning",
    });
    expect(checklist.coverageItems.find((item) => item.id === "payload-tabs")).toMatchObject({
      pulled: null,
      status: "warning",
    });
    expect(checklist.coverageItems.find((item) => item.id === "raw-workbook")).toMatchObject({
      pulled: 0,
      status: "warning",
    });
  });

  it("renders skipped enrichment coverage as zero rows instead of unknown", () => {
    const checklist = buildDailyPullChecklist({
      selectedDate: "2026-06-01",
      sourceHealth: sources(),
      summary: summary({
        date: "2026-06-01",
        optionIntradayContractCount: 0,
        optionIntradayExpectedRows: 0,
        optionIntradayExpectedRowsPerContract: 0,
        optionIntradayRowCount: 0,
        optionIntradayStatus: "skipped",
        underlyingIntradayExpectedRows: 2730,
        underlyingIntradayRowCount: 0,
        underlyingIntradayStatus: "missing",
        underlyingIntradaySymbolCount: 7,
        volumeProfileExpectedRows: 0,
        volumeProfileRowCount: 0,
      }),
      tradeCount: 22,
    });

    expect(checklist.coverageItems.find((item) => item.id === "option-bars")).toMatchObject({
      expected: 0,
      expectedLabel: "0 rows",
      missing: 0,
      missingLabel: "0 rows",
      pulled: 0,
      pulledLabel: "0 rows",
    });
    expect(checklist.coverageItems.find((item) => item.id === "volume-profile")).toMatchObject({
      expected: 0,
      expectedLabel: "0 rows",
      missing: 0,
      missingLabel: "0 rows",
      pulled: 0,
      pulledLabel: "0 rows",
    });
    expect(checklist.coverageItems.find((item) => item.id === "underlying-bars")).toMatchObject({
      expected: 2730,
      expectedLabel: "2,730 rows",
      missing: 2730,
      missingLabel: "2,730 rows",
      pulled: 0,
      pulledLabel: "0 rows",
    });
  });

  it("keeps far-away option and OI gaps as notes instead of sidebar warnings", () => {
    const checklist = buildDailyPullChecklist({
      selectedDate: "2026-05-29",
      sourceHealth: sources(),
      summary: summary({
        issues: [
          {
            detail: "Open interest gap distance: all 4 scored missing contracts are at least 100 pts from SPX open 7,580 / close 7,582; treated as non-blocking.",
            severity: "info",
            stage: "pull",
            title: "Open interest pull not fully clean",
          },
          {
            detail: "Option intraday row gap distance: all 6 scored missing contracts are at least 100 pts from SPX open 7,580 / close 7,582; treated as non-blocking.",
            severity: "info",
            stage: "pull",
            title: "Unexpected option pull errors",
          },
          {
            detail: "Volume profile gap distance: all scored missing rows are at least 100 pts from SPX open/close.",
            severity: "info",
            stage: "pull",
            title: "Far volume profile gaps ignored",
          },
        ],
        issueCount: 0,
        optionIntradayStatus: "ok",
      }),
      tradeCount: 9,
    });

    expect(checklist.steps.find((step) => step.id === "option-intraday")).toMatchObject({
      status: "complete",
      warnings: [],
    });
    expect(checklist.steps.find((step) => step.id === "option-intraday")?.notes.join(" ")).toContain("at least 100 pts");
    expect(checklist.steps.find((step) => step.id === "open-interest")).toMatchObject({
      status: "complete",
      warnings: [],
    });
    expect(checklist.steps.find((step) => step.id === "open-interest")?.notes.join(" ")).toContain("non-blocking");
    expect(checklist.coverageItems.find((item) => item.id === "open-interest")?.warnings).toEqual([]);
    expect(checklist.coverageItems.find((item) => item.id === "volume-profile")?.notes.join(" ")).toContain("Far volume profile gaps ignored");
    expect(checklist.coverageItems.find((item) => item.id === "volume-profile")?.warnings).toEqual([]);
  });
});

function summary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    availabilityStatus: "ok",
    date: "2026-05-29",
    entryCount: 19,
    fillCount: 136,
    issueCount: 0,
    issues: [],
    optionContractCount: 12,
    optionIntradayBarSize: "5s",
    optionIntradayContractCount: 120,
    optionIntradayExpectedRows: 583200,
    optionIntradayExpectedRowsPerContract: 4860,
    optionIntradayRowCount: 495720,
    optionIntradayStatus: "ok",
    payloadRows: 59333,
    spxIntradayBarSize: "5s",
    spxIntradayExpectedRows: 4680,
    spxIntradayRowCount: 4680,
    spreadMarkExpectedRows: 92340,
    spreadMarkRowCount: 90396,
    rawUploadGoogleSheetUrl: "https://docs.google.com/spreadsheets/d/raw",
    openInterestExpectedRows: 120,
    openInterestRowCount: 120,
    openInterestValidRowCount: 112,
    spxStatus: "ok",
    spreadCount: 24,
    tradeCount: 136,
    tradeArtifactExpectedCount: 4,
    tradeArtifactReadyCount: 4,
    tradeStatus: "ok",
    tradedOptionContractCount: 12,
    underlyingIntradayExpectedRows: 2340,
    underlyingIntradayRowCount: 2340,
    underlyingIntradayStatus: "ok",
    underlyingIntradaySymbolCount: 6,
    uploadStatus: "uploaded",
    uploadTabCount: 10,
    volumeProfileExpectedRows: 583200,
    volumeProfileRowCount: 495720,
    ...overrides,
  };
}

function syncStatus(overrides: Partial<DailySyncStatusResult> = {}): DailySyncStatusResult {
  return {
    generatedAt: "2026-06-01T21:00:00.000Z",
    latestSummary: { date: "2026-06-01", entryCount: 22, fillCount: 75, path: "daily_sync_summary.json", spreadCount: 31, status: "incomplete" },
    message: "Daily sync is running.",
    ok: true,
    state: "running",
    targetPlan: {
      afterCutoff: true,
      cutoffTimeEt: "16:25",
      estimatedTargetDate: "2026-06-01",
      mode: "auto",
      note: "Auto targets today.",
      nowEt: "2026-06-01 17:00 ET",
      requestedDate: "auto",
    },
    ...overrides,
  };
}

function sources(overrides: Partial<SourceHealth>[] = []): SourceHealth[] {
  const base: SourceHealth[] = [
    { detail: "4 Daily Sync Runs rows captured.", label: "Google Drive connector snapshot", status: "ok" },
    { count: 59333, detail: "2026-05-29 payload ready.", label: "Staged sheet payload", status: "ok" },
    { detail: "Raw workbook receipt exists.", label: "Google raw workbook access", status: "ok" },
    { count: 66, detail: "Normalized entries available.", label: "AI STUFF IBKR trade mirror", status: "ok" },
    { detail: "Latest replay date: 2026-05-29.", label: "Replay market data", status: "ok" },
    { detail: "Launcher ready.", label: "AI STUFF daily sync launcher", status: "ok" },
    { detail: "Wallet loaded from account snapshot.", label: "IBKR wallet", status: "ok" },
  ];
  for (const override of overrides) {
    const index = base.findIndex((source) => source.label === override.label);
    if (index >= 0) {
      base[index] = { ...base[index], ...override };
    } else if (override.label && override.status && override.detail) {
      base.push(override as SourceHealth);
    }
  }
  return base;
}
