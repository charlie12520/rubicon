import { describe, expect, it } from "vitest";
import type { DailySyncStatusResult } from "../shared/types";
import { buildDailySyncRunGuard } from "./dailySyncRunGuard";

function status(overrides: Partial<DailySyncStatusResult> = {}): DailySyncStatusResult {
  return {
    generatedAt: "2026-05-29T20:09:00.000Z",
    message: "Daily SPX/IBKR sync is idle.",
    ok: true,
    state: "idle",
    targetPlan: {
      afterCutoff: false,
      cutoffTimeEt: "16:25",
      estimatedTargetDate: "2026-05-28",
      mode: "auto",
      note: "Auto mode is estimated to target the previous session.",
      nowEt: "2026-05-29 16:09 ET",
      requestedDate: "auto",
    },
    ...overrides,
  };
}

describe("daily sync run guard", () => {
  it("locks the live run while auto still targets the prior session", () => {
    const guard = buildDailySyncRunGuard(status(), "2026-05-29");

    expect(guard.disabled).toBe(true);
    expect(guard.title).toContain("Auto would still target 2026-05-28");
    expect(guard.title).toContain("unlocks after 16:25 ET");
  });

  it("unlocks the live run after auto targets today", () => {
    const guard = buildDailySyncRunGuard(
      status({
        targetPlan: {
          afterCutoff: true,
          cutoffTimeEt: "16:25",
          estimatedTargetDate: "2026-05-29",
          mode: "auto",
          note: "Auto mode is estimated to target today's session.",
          nowEt: "2026-05-29 16:30 ET",
          requestedDate: "auto",
        },
      }),
      "2026-05-29",
    );

    expect(guard.disabled).toBe(false);
  });

  it("locks duplicate launches while a sync is already running", () => {
    const guard = buildDailySyncRunGuard(status({ state: "running" }), "2026-05-29");

    expect(guard.disabled).toBe(true);
    expect(guard.title).toBe("Daily SPX/IBKR sync is already running.");
  });
});
