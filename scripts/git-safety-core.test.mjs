import { describe, expect, it } from "vitest";
import { checkAcceptanceLedger, checkBranchGuard, checkStagedChangeMix, runGitSafetyChecks } from "./git-safety-core.mjs";

const ledger = (active, rows) => [
  "```yaml",
  `active_acceptance_id: ${active}`,
  "```",
  "| ID | Requirement | Status | Proof |",
  "|---|---|---:|---|",
  ...rows.map((id) => `| ${id} | Requirement | GREEN | Proof |`),
].join("\n");

describe("git safety checks", () => {
  it("rejects duplicate acceptance rows", () => {
    const result = checkAcceptanceLedger({ stagedContent: ledger("A196", ["A196", "A195", "A196"]) });
    expect(result.problems.join("\n")).toContain("duplicate acceptance rows: A196");
  });

  it("rejects active IDs lower than the staged table max", () => {
    const result = checkAcceptanceLedger({ stagedContent: ledger("A195", ["A196", "A195"]) });
    expect(result.problems.join("\n")).toContain("lower than current table max A196");
  });

  it("rejects active ID regressions below HEAD", () => {
    const result = checkAcceptanceLedger({
      stagedContent: ledger("A195", ["A195"]),
      headContent: ledger("A196", ["A196"]),
    });
    expect(result.problems.join("\n")).toContain("regresses below HEAD A196");
  });

  it("rejects direct main commits unless the landing override is set", () => {
    expect(checkBranchGuard({ branch: "main", env: {} }).join("\n")).toContain("Direct commits");
    expect(checkBranchGuard({ branch: "main", env: { RUBICON_LANDING_OVERRIDE: "1" } })).toEqual([]);
  });

  it("rejects broad archive moves mixed with source changes", () => {
    const status = [
      "R100\tACCEPTANCE_CRITERIA.md\tarchive/ACCEPTANCE_CRITERIA.md",
      "R100\tVALIDATION.md\tarchive/VALIDATION.md",
      "R100\tCOMPLETION_AUDIT.md\tarchive/COMPLETION_AUDIT.md",
      "M\tserver/selfUpdate.ts",
    ].join("\n");

    expect(checkStagedChangeMix(status).problems.join("\n")).toContain("Split these commits");
  });

  it("allows pure archive rotations and focused source commits", () => {
    expect(checkStagedChangeMix("R100\tVALIDATION.md\tarchive/VALIDATION.md").problems).toEqual([]);
    expect(checkStagedChangeMix("M\tserver/selfUpdate.ts\nM\tsrc/App.tsx").problems).toEqual([]);
  });

  it("combines branch, ledger, and staging problems for hooks", () => {
    const problems = runGitSafetyChecks({
      branch: "main",
      nameStatusText: "M\tserver/selfUpdate.ts",
      stagedAcceptanceContent: ledger("A195", ["A196"]),
      env: {},
    });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});
