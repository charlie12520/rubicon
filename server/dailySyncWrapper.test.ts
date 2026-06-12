import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WRAPPER_PATH = path.resolve(process.cwd(), "..", "IBKR Equity History Pull", "run_daily_spx_ibkr_sync_with_sheet_payload.ps1");
const TC2000_CONTROL_PATH = path.resolve(process.cwd(), "..", "scripts", "tc2000_control_panel.ps1");

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

  it("runs bounded SPX spread-leg repair with chunk-first 25s option requests", () => {
    const wrapper = readWrapper();
    const configIndex = wrapper.indexOf('StepId = "option-spx-spread-legs"; Label = "SPX spread-leg option pull"; Scope = "spx-spread-legs"; SoftBudgetSeconds = 480; HardBudgetSeconds = 540');
    const stepIndex = wrapper.indexOf("function Invoke-OptionSidecarStep");
    const commandIndex = wrapper.indexOf('"--option-history-window-mode", $HistoryWindowMode', stepIndex);

    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(stepIndex).toBeGreaterThanOrEqual(0);
    expect(wrapper.slice(stepIndex, commandIndex)).toContain('$HistoryWindowMode = if ($Config.Scope -eq "spx-spread-legs") { "chunk-first" } else { "full-first" }');
    expect(wrapper.slice(stepIndex, commandIndex)).toContain('"--option-request-timeout-s", "25"');
    expect(commandIndex).toBeGreaterThan(stepIndex);
  });

  it("passes TC2000 export freshness into the daily-bars refresh", () => {
    const wrapper = readWrapper();
    const barsIndex = wrapper.indexOf("$DailyBarsArgs = @(");

    expect(barsIndex).toBeGreaterThanOrEqual(0);
    expect(wrapper.slice(barsIndex, barsIndex + 500)).toContain("--fresh-after");
    expect(wrapper.slice(barsIndex, barsIndex + 500)).toContain("$Tc2000ExportStartedAt.ToUniversalTime().ToString(\"o\")");
    expect(wrapper.slice(barsIndex, barsIndex + 500)).toContain("--require-fresh-sources");
    expect(wrapper).toContain("TC2000 daily-bar refresh completed with scanner freshness warnings");
  });
});

describe.skipIf(!fs.existsSync(TC2000_CONTROL_PATH))("TC2000 control panel PowerShell script", () => {
  it("dismisses known blocking prompts before OCR and retries prompt failures", () => {
    const script = fs.readFileSync(TC2000_CONTROL_PATH, "utf8");
    const exportIndex = script.indexOf("function Export-Tc2000WindowSymbols");
    const preCaptureDismissIndex = script.indexOf("Dismiss-Tc2000KnownPrompt", exportIndex);
    const snapshotIndex = script.indexOf("Save-Tc2000Snapshot", exportIndex);
    const promptRetryIndex = script.indexOf("$exitCode -eq 4", exportIndex);

    expect(script).toContain("function Find-Tc2000BlockingPrompt");
    expect(script).toContain("Open Postmarket Watchlist");
    expect(preCaptureDismissIndex).toBeGreaterThan(exportIndex);
    expect(snapshotIndex).toBeGreaterThan(preCaptureDismissIndex);
    expect(promptRetryIndex).toBeGreaterThan(snapshotIndex);
    expect(script).toContain("-DismissKnownPrompts:(-not $NoPromptDismiss)");
  });
});
