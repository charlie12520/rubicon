import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WRAPPER_PATH = path.resolve(process.cwd(), "..", "IBKR Equity History Pull", "run_daily_spx_ibkr_sync_with_sheet_payload.ps1");

function readWrapper(): string {
  return fs.readFileSync(WRAPPER_PATH, "utf8");
}

// The wrapper lives in the sibling IBKR project, which only exists on the
// trading machine — skip (don't fail) on CI runners.
describe.skipIf(!fs.existsSync(WRAPPER_PATH))("daily sync PowerShell wrapper", () => {
  it("retries review-critical SPX spread legs before failing Data Collection", () => {
    const wrapper = readWrapper();
    const earlyRetryIndex = wrapper.indexOf('Invoke-OptionSidecarSequence -Date $ResolvedTradeDate -Scope "spx-spread-legs"');
    const hardFailureIndex = wrapper.indexOf('throw "Data Collection blocked local review for $ResolvedTradeDate."');

    expect(earlyRetryIndex).toBeGreaterThanOrEqual(0);
    expect(hardFailureIndex).toBeGreaterThan(earlyRetryIndex);
  });

  it("runs TC2000 steps even when Data Collection blocks local review", () => {
    const wrapper = readWrapper();
    expect(wrapper).toContain("function Invoke-Tc2000Steps");

    const retryIndex = wrapper.indexOf('Invoke-OptionSidecarSequence -Date $ResolvedTradeDate -Scope "spx-spread-legs"');
    const blockedThrowIndex = wrapper.indexOf('throw "Data Collection blocked local review for $ResolvedTradeDate."');
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(blockedThrowIndex).toBeGreaterThan(retryIndex);

    const blockedSection = wrapper.slice(retryIndex, blockedThrowIndex);
    expect(blockedSection).toContain("Invoke-Tc2000Steps");
  });

  it("manual option retry finishes the day's sheet payload + Google upload when review clears", () => {
    const wrapper = readWrapper();
    expect(wrapper).toContain("function Invoke-SheetPayloadAndUploadSteps");
    // the retry branch must no longer blanket-mark the upload steps complete
    expect(wrapper).not.toContain('Set-SyncStep -Id "google-upload" -Status "complete" -Detail "Skipped for manual option retry."');

    const retryBranchIndex = wrapper.indexOf("if ($OptionSidecarsOnly) {");
    const retrySidecarsIndex = wrapper.indexOf("Invoke-OptionSidecarSequence -Date $ResolvedTradeDate -Scope $OptionSidecarScope", retryBranchIndex);
    const retryUploadIndex = wrapper.indexOf("Invoke-SheetPayloadAndUploadSteps", retrySidecarsIndex);
    const retryExitIndex = wrapper.indexOf("exit 0", retrySidecarsIndex);
    expect(retryBranchIndex).toBeGreaterThanOrEqual(0);
    expect(retrySidecarsIndex).toBeGreaterThan(retryBranchIndex);
    expect(retryUploadIndex).toBeGreaterThan(retrySidecarsIndex);
    expect(retryUploadIndex).toBeLessThan(retryExitIndex);
  });

  it("keeps the broad failed-or-missing retry after Google upload", () => {
    const wrapper = readWrapper();
    const googleUploadFinishedIndex = wrapper.indexOf('Write-RubiconSyncStatus -State "running" -Ok ($SyncHardFailures.Count -eq 0) -Message "Google Upload stage finished."');
    const finalRetryIndex = wrapper.indexOf('Invoke-OptionSidecarSequence -Date $ResolvedTradeDate -Scope "failed-or-missing"', googleUploadFinishedIndex);

    expect(googleUploadFinishedIndex).toBeGreaterThanOrEqual(0);
    expect(finalRetryIndex).toBeGreaterThan(googleUploadFinishedIndex);
  });
});
