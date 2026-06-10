import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WRAPPER_PATH = path.resolve(process.cwd(), "..", "IBKR Equity History Pull", "run_daily_spx_ibkr_sync_with_sheet_payload.ps1");

function readWrapper(): string {
  return fs.readFileSync(WRAPPER_PATH, "utf8");
}

describe("daily sync PowerShell wrapper", () => {
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

  it("keeps the broad failed-or-missing retry after Google upload", () => {
    const wrapper = readWrapper();
    const googleUploadFinishedIndex = wrapper.indexOf('Write-RubiconSyncStatus -State "running" -Ok ($SyncHardFailures.Count -eq 0) -Message "Google Upload stage finished."');
    const finalRetryIndex = wrapper.indexOf('Invoke-OptionSidecarSequence -Date $ResolvedTradeDate -Scope "failed-or-missing"', googleUploadFinishedIndex);

    expect(googleUploadFinishedIndex).toBeGreaterThanOrEqual(0);
    expect(finalRetryIndex).toBeGreaterThan(googleUploadFinishedIndex);
  });
});
