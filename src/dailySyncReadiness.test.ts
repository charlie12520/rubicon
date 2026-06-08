import { describe, expect, it } from "vitest";
import type { DailySyncStatusResult } from "../shared/types";
import { buildDailySyncReadiness } from "./dailySyncReadiness";

function status(overrides: Partial<DailySyncStatusResult> = {}): DailySyncStatusResult {
  return {
    generatedAt: "2026-05-29T10:54:00.000Z",
    message: "Daily pipeline is idle.",
    ok: true,
    state: "idle",
    targetPlan: {
      afterCutoff: false,
      cutoffTimeEt: "07:00",
      estimatedTargetDate: "2026-05-28",
      mode: "auto",
      note: "Auto mode is estimated to target the previous session.",
      nowEt: "2026-05-29 06:54 ET",
      requestedDate: "auto",
    },
    ...overrides,
  };
}

describe("daily sync readiness", () => {
  it("warns before the same-day auto cutoff when today is not imported", () => {
    const readiness = buildDailySyncReadiness(status(), "2026-05-29", "2026-05-28");

    expect(readiness.tone).toBe("warning");
    expect(readiness.label).toBe("Same-day pipeline opens at 07:00 ET");
    expect(readiness.detail).toContain("Auto is still targeting 2026-05-28");
    expect(readiness.detail).toContain("2026-05-29 pipeline opens after 07:00 ET");
    expect(readiness.detail).toContain("about 6 minutes from now");
  });

  it("marks today ready after auto targets today", () => {
    const readiness = buildDailySyncReadiness(
      status({
        targetPlan: {
          afterCutoff: true,
          cutoffTimeEt: "07:00",
          estimatedTargetDate: "2026-05-29",
          mode: "auto",
          note: "Auto mode is estimated to target today's session.",
          nowEt: "2026-05-29 07:30 ET",
          requestedDate: "auto",
        },
      }),
      "2026-05-29",
      "2026-05-28",
    );

    expect(readiness.tone).toBe("ok");
    expect(readiness.label).toBe("Today pipeline ready");
    expect(readiness.detail).toContain("Auto is targeting today's archive 2026-05-29");
  });

  it("treats an imported today archive as current even before considering sync status", () => {
    const readiness = buildDailySyncReadiness(status(), "2026-05-29", "2026-05-29");

    expect(readiness.tone).toBe("ok");
    expect(readiness.label).toBe("Today imported");
  });

  it("does not show same-day cutoff readiness on weekends", () => {
    const readiness = buildDailySyncReadiness(status(), "2026-05-31", "2026-05-29");

    expect(readiness.tone).toBe("ok");
    expect(readiness.label).toBe("Market closed");
    expect(readiness.detail).toContain("weekend date (2026-05-31)");
    expect(readiness.detail).toContain("latest trading session 2026-05-29");
  });
});
