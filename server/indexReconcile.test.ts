import { describe, expect, it, vi } from "vitest";
import { planReconcileActions, runIndexReconcileOnce, type ReconcileOutcome } from "./indexReconcile.ts";

const base = (indexes: ReconcileOutcome["indexes"], over: Partial<ReconcileOutcome> = {}): ReconcileOutcome => ({
  ok: true,
  applied: true,
  gate: "pass",
  indexes,
  ...over,
});

describe("planReconcileActions", () => {
  it("summarises real adds/drops and asks for a fresh universe pull", () => {
    const plan = planReconcileActions(
      base({
        spx: {
          added: [{ symbol: "FDXF", sector: "Industrials", industry: "Unclassified", via: "gics-sector" }],
          dropped: [{ symbol: "EPAM" }],
        },
        qqq: { added: [], dropped: [] },
      }),
    );
    expect(plan.freshPull).toBe(true);
    expect(plan.toast?.title).toBe("Index reconstitution");
    expect(plan.toast?.body).toContain("S&P 500:");
    expect(plan.toast?.body).toContain("+FDXF (Industrials)");
    expect(plan.toast?.body).toContain("−EPAM");
    expect(plan.toast?.body).not.toContain("Nasdaq-100"); // qqq had no changes
    expect(plan.toast?.detail).toMatch(/set their industry/i);
  });

  it("flags a new name that got no sector (manual placement needed)", () => {
    const plan = planReconcileActions(
      base({ qqq: { added: [{ symbol: "NEWCO", sector: "Other", industry: "Unclassified", via: "no-sector" }], dropped: [] } }),
    );
    expect(plan.freshPull).toBe(true);
    expect(plan.toast?.detail).toMatch(/No sector yet.*NEWCO/);
  });

  it("does nothing on an empty diff", () => {
    const plan = planReconcileActions(base({ spx: { added: [], dropped: [] }, qqq: { added: [], dropped: [] } }));
    expect(plan.toast).toBeNull();
    expect(plan.freshPull).toBe(false);
  });

  it("does nothing on a first-run bootstrap (seed only)", () => {
    const plan = planReconcileActions(base({ spx: { bootstrapped: true, added: [], dropped: [] } }));
    expect(plan.toast).toBeNull();
    expect(plan.freshPull).toBe(false);
  });

  it("fires a 'review manually' toast and NO pull when the safety gate trips", () => {
    const plan = planReconcileActions(
      base({ spx: { gate: "blocked", reason: "churn 30 > 5.0% of 503", added: [], dropped: [] } }, { applied: false, gate: "blocked" }),
    );
    expect(plan.freshPull).toBe(false);
    expect(plan.toast?.title).toMatch(/review manually/i);
    expect(plan.toast?.body).toContain("churn 30");
  });

  it("treats a script error as review-manually, no pull", () => {
    const plan = planReconcileActions({ ok: false, applied: false, gate: "error", indexes: {}, error: "boom" });
    expect(plan.freshPull).toBe(false);
    expect(plan.toast?.title).toMatch(/review manually/i);
    expect(plan.toast?.body).toContain("boom");
  });
});

describe("runIndexReconcileOnce (side-effect wiring)", () => {
  const deps = (outcome: ReconcileOutcome | (() => Promise<ReconcileOutcome>)) => {
    const toast = vi.fn();
    const freshPull = vi.fn();
    const runReconcile = typeof outcome === "function" ? outcome : () => Promise.resolve(outcome);
    return { toast, freshPull, runReconcile };
  };

  it("non-empty diff → toast once + fresh pull once", async () => {
    const d = deps(base({ spx: { added: [{ symbol: "FDXF", sector: "Industrials", industry: "Unclassified", via: "gics-sector" }], dropped: [] } }));
    await runIndexReconcileOnce(d);
    expect(d.toast).toHaveBeenCalledTimes(1);
    expect(d.freshPull).toHaveBeenCalledTimes(1);
  });

  it("empty diff → neither toast nor pull", async () => {
    const d = deps(base({ spx: { added: [], dropped: [] } }));
    await runIndexReconcileOnce(d);
    expect(d.toast).not.toHaveBeenCalled();
    expect(d.freshPull).not.toHaveBeenCalled();
  });

  it("gate blocked → review toast, NO pull", async () => {
    const d = deps(base({ spx: { gate: "blocked", reason: "floor", added: [], dropped: [] } }, { applied: false, gate: "blocked" }));
    await runIndexReconcileOnce(d);
    expect(d.toast).toHaveBeenCalledTimes(1);
    expect(d.freshPull).not.toHaveBeenCalled();
  });

  it("reconcile throw → review toast, NO pull (never crashes)", async () => {
    const d = deps(() => Promise.reject(new Error("spawn failed")));
    const plan = await runIndexReconcileOnce(d);
    expect(plan.toast?.title).toMatch(/review manually/i);
    expect(d.toast).toHaveBeenCalledTimes(1);
    expect(d.freshPull).not.toHaveBeenCalled();
  });
});
