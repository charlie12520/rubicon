import { describe, expect, it } from "vitest";
import { morningAutoArmDecision, morningAutoRefreshDecision } from "./morningAutoArm";

describe("morning alert auto-arm", () => {
  it("arms once inside the 8:30 ET morning window", () => {
    const decision = morningAutoArmDecision(new Date("2026-05-29T12:30:00.000Z"), null);

    expect(decision.date).toBe("2026-05-29");
    expect(decision.time).toBe("08:30");
    expect(decision.shouldArm).toBe(true);
  });

  it("does not repeatedly re-arm after the same ET date has fired", () => {
    const decision = morningAutoArmDecision(new Date("2026-05-29T12:31:00.000Z"), "2026-05-29");

    expect(decision.shouldArm).toBe(false);
  });

  it("does not arm during weekends or outside the catchup window", () => {
    expect(morningAutoArmDecision(new Date("2026-05-31T12:30:00.000Z"), null).shouldArm).toBe(false);
    expect(morningAutoArmDecision(new Date("2026-05-29T12:40:00.000Z"), null).shouldArm).toBe(false);
  });
});

describe("morning brief auto-refresh", () => {
  it("refreshes once for the selected ET date after the morning data pull time", () => {
    const decision = morningAutoRefreshDecision(new Date("2026-05-29T12:30:00.000Z"), null, "2026-05-29");

    expect(decision.date).toBe("2026-05-29");
    expect(decision.time).toBe("08:30");
    expect(decision.shouldRefresh).toBe(true);
  });

  it("catches up later in the morning but does not repeat for the same ET date", () => {
    expect(morningAutoRefreshDecision(new Date("2026-05-29T14:15:00.000Z"), null, "2026-05-29").shouldRefresh).toBe(true);
    expect(morningAutoRefreshDecision(new Date("2026-05-29T14:15:00.000Z"), "2026-05-29", "2026-05-29").shouldRefresh).toBe(false);
  });

  it("does not refresh weekends, before 8:30 ET, or when Morning is on another date", () => {
    expect(morningAutoRefreshDecision(new Date("2026-05-31T14:15:00.000Z"), null, "2026-05-31").shouldRefresh).toBe(false);
    expect(morningAutoRefreshDecision(new Date("2026-05-29T12:29:00.000Z"), null, "2026-05-29").shouldRefresh).toBe(false);
    expect(morningAutoRefreshDecision(new Date("2026-05-29T14:15:00.000Z"), null, "2026-05-28").shouldRefresh).toBe(false);
  });
});
