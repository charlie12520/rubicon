# Rubicon Daily Sync Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rubicon's daily sync status truthful after wrapper/sidecar exits, prevent stale "running" state after a dead launcher, and recover the missing 2026-06-08 Google tracker payload/upload.

**Architecture:** Keep the Python/PowerShell data pipeline as the producer of local artifacts, and harden Rubicon's TypeScript status layer as the source of truth for UI state. Completion merging should distinguish review-critical local readiness from non-blocking stage/upload problems. The PowerShell wrapper should always finish child-process capture cleanly and write a final status before exiting.

**Tech Stack:** React/Vite frontend, Express/TypeScript backend, Vitest, PowerShell 5.1 wrapper, Python local IBKR/Google-payload scripts.

---

## Investigation Summary

Observed on 2026-06-08:

- Main daily data exists and is locally usable:
  - `223` fills
  - `17` entries
  - `4,680` SPX 5-second bars
  - after retry: `104,349` option leg rows and `82,620` spread marks
  - `/api/tracker` loads `2026-06-08`
  - `/api/replay?date=2026-06-08` serves `17` quick trades, `4,680` SPX bars, and sampled spread marks
- Sync status is wrong:
  - `data/daily-sync-status.json` says `state:"failed"`, `ok:false`, `pipelineState:"running"`
  - the current step still says `option-spx-spread-legs` is `running`
  - `reviewReady:true`, so this should not be a hard local-review failure
  - lock PID `37464` is stale
- Google upload is genuinely incomplete:
  - no `IBKR Equity History Pull/data/ibkr_trades/2026-06-08/google_sheet_upload_payload.json`
  - tracker summary reports `uploadStatus:"missing_payload"`
  - API reports `googleUploaded:false`
- The PowerShell wrapper showed prior `ProcessStartInfo.ArgumentList` fragility in logs and appears to let Python continue after wrapper death in this run. The durable fix must make process capture and final status writes reliable, not just change UI labels.

## Files

- Modify: `server/dailySync.ts`
  - Add pure finalization helpers for closed processes.
  - Normalize stale persisted running state when no live process/lock exists.
  - Treat non-zero wrapper exit as a warning when local review is ready and review-critical stages are usable.
  - Preserve Google upload truth separately from option-retry status.
- Modify: `server/dailySync.test.ts`
  - Add regression tests for stale running closure, non-zero option retry exit, and non-blocking Google upload gaps.
- Modify: `src/dailySyncProgress.ts`
  - Ensure closed statuses never render "Running:" solely because stale steps still say `running`.
- Modify: `src/dailySyncProgress.test.ts`
  - Add a UI-model regression for failed/completed status with stale running step.
- Modify: `C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1`
  - Replace fragile async `BeginOutputReadLine` capture in `Invoke-CapturedProcessWithLiveProgress` with a polling capture loop that cannot let the wrapper exit while child Python is alive.
  - Ensure option-sidecars-only exits `0` after writing `completed` unless there is an actual wrapper-level launch failure.
- No code change for immediate remediation:
  - Run existing payload and upload commands once after code is fixed or if an operator wants today's Google row repaired immediately.

---

### Task 1: Backend Completion Merge Truth

**Files:**
- Modify: `server/dailySync.test.ts`
- Modify: `server/dailySync.ts`

- [ ] **Step 1: Write failing tests for non-zero launcher exits that still have review-ready local data**

Append these tests inside `describe("daily SPX/IBKR sync launcher", () => { ... })` in `server/dailySync.test.ts`:

```ts
  it("does not fail a review-ready option retry just because the wrapper exits non-zero", () => {
    const launched = {
      ok: true,
      state: "running" as const,
      message: "Failed/missing option data retry started for 2026-06-08.",
      generatedAt: "2026-06-08T21:16:59.028Z",
      startedAt: "2026-06-08T21:16:59.028Z",
      runId: "option-retry-2026-06-08-20260608211659",
      targetDate: "2026-06-08",
    };
    const persisted = {
      ...launched,
      message: "Running bounded SPX spread-leg option pull.",
      reviewReady: true,
      googleUploaded: true,
      pipelineState: "running" as const,
      stages: {
        dataCollection: {
          id: "dataCollection" as const,
          label: "Data Collection",
          status: "complete" as const,
          detail: "Manual option retry uses existing review-critical local files.",
          blockers: [],
          warnings: [],
        },
        rubiconIngest: {
          id: "rubiconIngest" as const,
          label: "Rubicon Ingest",
          status: "complete" as const,
          detail: "Manual option retry will refresh option-derived Rubicon state if needed.",
          blockers: [],
          warnings: [],
        },
        googleUpload: {
          id: "googleUpload" as const,
          label: "Google Upload",
          status: "complete" as const,
          detail: "Manual option retry does not change Google tracker rows.",
          blockers: [],
          warnings: [],
        },
      },
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" as const },
        {
          id: "option-spx-spread-legs",
          label: "Option SPX spread legs",
          status: "running" as const,
          detail: "Running bounded SPX spread-leg option pull with hard timeout 360s.",
        },
        {
          id: "option-open-interest",
          label: "Option open interest",
          status: "pending" as const,
          detail: "Waiting for bounded option open-interest pull.",
        },
      ],
    };

    const merged = mergeDailySyncCompletionStatus({
      exitCode: 2,
      finishedAt: "2026-06-08T21:19:14.114Z",
      launched,
      persisted,
    });

    expect(merged.ok).toBe(true);
    expect(merged.state).toBe("completed");
    expect(merged.pipelineState).toBe("completed");
    expect(merged.message).toContain("completed with warnings");
    expect(merged.warnings?.join("\n")).toContain("launcher exited with code 2");
    expect(merged.steps?.find((step) => step.id === "option-spx-spread-legs")?.status).toBe("warning");
    expect(merged.steps?.find((step) => step.id === "option-open-interest")?.status).toBe("warning");
  });

  it("keeps local review ready while surfacing a missing Google payload as a stage error", () => {
    const launched = {
      ok: true,
      state: "running" as const,
      message: "Daily pipeline started.",
      generatedAt: "2026-06-08T20:00:09.151Z",
      startedAt: "2026-06-08T20:00:09.151Z",
      targetDate: "2026-06-08",
    };
    const persisted = {
      ...launched,
      reviewReady: true,
      stages: {
        dataCollection: {
          id: "dataCollection" as const,
          label: "Data Collection",
          status: "complete" as const,
          detail: "Local review data is usable.",
        },
        rubiconIngest: {
          id: "rubiconIngest" as const,
          label: "Rubicon Ingest",
          status: "complete" as const,
          detail: "Rubicon state refreshed.",
        },
        googleUpload: {
          id: "googleUpload" as const,
          label: "Google Upload",
          status: "failed" as const,
          detail: "Google Sheet upload payload missing.",
          blockers: ["No google_sheet_upload_payload.json found for 2026-06-08."],
        },
      },
    };

    const merged = mergeDailySyncCompletionStatus({
      exitCode: 2,
      finishedAt: "2026-06-08T20:06:56.984Z",
      launched,
      persisted,
    });

    expect(merged.ok).toBe(true);
    expect(merged.state).toBe("completed");
    expect(merged.reviewReady).toBe(true);
    expect(merged.googleUploaded).toBe(false);
    expect(merged.pipelineState).toBe("failed-with-stage-errors");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm run test -- server/dailySync.test.ts
```

Expected: the new tests fail because `mergeDailySyncCompletionStatus()` currently sets `ok:false`, `state:"failed"`, preserves stale running steps, and/or leaves `pipelineState:"running"`.

- [ ] **Step 3: Implement completion finalization in `server/dailySync.ts`**

Add these helpers above `mergeDailySyncCompletionStatus()`:

```ts
function terminalizeStepAfterClose(step: DailySyncStep, finishedAt: string, wrapperExitCode: number | null): DailySyncStep {
  if (step.status !== "running" && step.status !== "pending") {
    return step;
  }
  const exitText = wrapperExitCode === 0 || wrapperExitCode === null ? "the launcher closed" : `the launcher exited with code ${wrapperExitCode}`;
  return {
    ...step,
    detail: step.status === "running"
      ? `${step.detail ?? step.label} ${exitText}; no further live progress is active.`
      : `${step.detail ?? step.label} was not reached before ${exitText}.`,
    status: "warning",
    updatedAt: finishedAt,
  };
}

function terminalizeStepsAfterClose(steps: DailySyncStep[] | undefined, finishedAt: string, wrapperExitCode: number | null): DailySyncStep[] | undefined {
  return steps?.map((step) => terminalizeStepAfterClose(step, finishedAt, wrapperExitCode));
}

function terminalizeStageAfterClose(stage: DailyPipelineStage, finishedAt: string, wrapperExitCode: number | null): DailyPipelineStage {
  if (stage.status !== "running" && stage.status !== "pending") {
    return stage;
  }
  const exitText = wrapperExitCode === 0 || wrapperExitCode === null ? "the launcher closed" : `the launcher exited with code ${wrapperExitCode}`;
  return {
    ...stage,
    detail: stage.status === "running"
      ? `${stage.detail ?? stage.label} stopped when ${exitText}.`
      : `${stage.detail ?? stage.label} was not reached before ${exitText}.`,
    status: "warning",
    updatedAt: finishedAt,
  };
}

function terminalizeStagesAfterClose(stages: DailyPipelineStages, finishedAt: string, wrapperExitCode: number | null): DailyPipelineStages {
  return {
    dataCollection: terminalizeStageAfterClose(stages.dataCollection, finishedAt, wrapperExitCode),
    rubiconIngest: terminalizeStageAfterClose(stages.rubiconIngest, finishedAt, wrapperExitCode),
    googleUpload: terminalizeStageAfterClose(stages.googleUpload, finishedAt, wrapperExitCode),
  };
}

function warningListWithWrapperExit(warnings: string[], exitCode: number | null, hardFailure: boolean): string[] {
  if (exitCode === 0 || exitCode === null || hardFailure) {
    return warnings;
  }
  return [...warnings, `Daily sync launcher exited with code ${exitCode}, but review-critical local data is ready; treating this as a non-blocking launcher warning.`];
}
```

Then replace the body of `mergeDailySyncCompletionStatus()` with this structure:

```ts
export function mergeDailySyncCompletionStatus({
  exitCode,
  finishedAt,
  launched,
  persisted,
}: DailySyncCompletionMergeInput): DailySyncStatusResult {
  const base = persisted ?? launched;
  const baseWarnings = Array.isArray(base.warnings) ? base.warnings.filter(Boolean) : [];
  const rawSteps = Array.isArray(base.steps) ? base.steps : launched.steps;
  const steps = terminalizeStepsAfterClose(rawSteps, finishedAt, exitCode);
  const normalizedBase = { ...base, steps };
  const stages = terminalizeStagesAfterClose(normalizeStages(normalizedBase, launched.startedAt), finishedAt, exitCode);
  const reviewReady = base.reviewReady ?? pipelineReviewReady(stages);
  const googleUploaded = resolveDailySyncGoogleUploaded({
    currentSummary: base.latestSummary,
    targetSummary: base.latestPipelineRun,
    persistedGoogleUploaded: base.googleUploaded,
    stages,
  });
  const hardFailure = !reviewReady || stageHasBlockers(stages.dataCollection) || stageHasBlockers(stages.rubiconIngest);
  const warnings = warningListWithWrapperExit(baseWarnings, exitCode, hardFailure);
  const state: DailySyncStatusResult["state"] = hardFailure ? "failed" : "completed";
  const pipelineState = pipelineStateFromStages(stages, state, hardFailure);
  const launchMessage = launched.message;
  const fallbackMessage = hardFailure
    ? `Daily pipeline exited with code ${exitCode ?? "unknown"}.`
    : warnings.length || pipelineState !== "completed"
      ? "Daily pipeline completed with warnings."
      : "Daily pipeline completed.";
  const message =
    !hardFailure && base.message && /running|waiting/i.test(base.message)
      ? fallbackMessage
      : base.message && base.message !== launchMessage
        ? base.message
        : fallbackMessage;

  return {
    ...launched,
    ...base,
    ok: !hardFailure,
    state,
    message,
    exitCode,
    finishedAt,
    generatedAt: finishedAt,
    googleUploaded,
    pipelineState,
    reviewReady,
    stages,
    steps,
    warnings: warnings.length ? warnings : undefined,
  };
}
```

- [ ] **Step 4: Run focused backend tests**

Run:

```powershell
npm run test -- server/dailySync.test.ts
```

Expected: all `server/dailySync.test.ts` tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/dailySync.ts server/dailySync.test.ts
git commit -m "fix: classify daily sync completion from review readiness"
```

---

### Task 2: Stale Running Status Guard

**Files:**
- Modify: `server/dailySync.test.ts`
- Modify: `server/dailySync.ts`

- [ ] **Step 1: Add a pure helper export and tests**

Add `resolveDailySyncRuntimeState` to the import list in `server/dailySync.test.ts`, then append:

```ts
  it("downgrades persisted running status when the lock is stale and no process is active", () => {
    expect(
      resolveDailySyncRuntimeState({
        activeProcess: false,
        persistedState: "running",
        lockActive: false,
        lockStale: true,
      }),
    ).toBe("failed");
    expect(
      resolveDailySyncRuntimeState({
        activeProcess: false,
        persistedState: "completed",
        lockActive: false,
        lockStale: true,
      }),
    ).toBe("completed");
    expect(
      resolveDailySyncRuntimeState({
        activeProcess: false,
        persistedState: "idle",
        lockActive: false,
        lockStale: false,
      }),
    ).toBe("idle");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npm run test -- server/dailySync.test.ts
```

Expected: TypeScript/Vitest fails because `resolveDailySyncRuntimeState` does not exist.

- [ ] **Step 3: Implement runtime-state normalization**

Add this exported helper near `readDailySyncLock()`:

```ts
export function resolveDailySyncRuntimeState({
  activeProcess,
  lockActive,
  lockStale,
  persistedState,
}: {
  activeProcess: boolean;
  lockActive: boolean;
  lockStale?: boolean;
  persistedState?: DailySyncStatusResult["state"];
}): DailySyncStatusResult["state"] {
  if (activeProcess || lockActive) {
    return "running";
  }
  if (persistedState === "running" && lockStale) {
    return "failed";
  }
  return persistedState ?? "idle";
}
```

Then change `getDailySyncStatus()`:

```ts
  const statusState = resolveDailySyncRuntimeState({
    activeProcess: Boolean(activeDailySync),
    lockActive: lock.active,
    lockStale: lock.stale,
    persistedState: persisted?.state,
  });
```

Also change `pipelineState` computation so stale failed state cannot keep `pipelineState:"running"`:

```ts
  const pipelineState =
    statusState === "failed" && persisted?.state === "running" && lock.stale
      ? "failed"
      : summaryGoogleUploaded(currentRunSummary ?? targetSummary)
        ? pipelineStateFromStages(stages, statusState)
        : persisted?.pipelineState === "running" && statusState !== "running"
          ? pipelineStateFromStages(stages, statusState)
          : persisted?.pipelineState ?? pipelineStateFromStages(stages, statusState);
```

- [ ] **Step 4: Run focused backend tests**

```powershell
npm run test -- server/dailySync.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add server/dailySync.ts server/dailySync.test.ts
git commit -m "fix: mark stale daily sync locks as stopped"
```

---

### Task 3: Progress Model Must Not Show Running After Closure

**Files:**
- Modify: `src/dailySyncProgress.test.ts`
- Modify: `src/dailySyncProgress.ts`

- [ ] **Step 1: Add failing progress-model regression**

Append this test in `src/dailySyncProgress.test.ts`:

```ts
  it("does not render a running label for a closed status with stale running steps", () => {
    const progress = buildDailySyncProgress(status({
      ok: false,
      state: "failed",
      pipelineState: "failed",
      message: "Daily sync launcher exited before status cleanup.",
      steps: [
        { id: "sync-started", label: "Sync started", status: "complete" },
        {
          id: "option-spx-spread-legs",
          label: "Option SPX spread legs",
          status: "running",
          detail: "Running bounded SPX spread-leg option pull.",
        },
      ],
    }));

    expect(progress.tone).toBe("error");
    expect(progress.label).not.toContain("Running:");
    expect(progress.detail).toBe("Daily sync launcher exited before status cleanup.");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```powershell
npm run test -- src/dailySyncProgress.test.ts
```

Expected: fails because `runningStep` currently wins even when `status.state` is closed.

- [ ] **Step 3: Update running-step selection**

In `src/dailySyncProgress.ts`, replace:

```ts
  const runningStep = steps.find((step) => step.status === "running");
```

with:

```ts
  const statusClosed = status?.state === "failed" || status?.state === "completed" || status?.pipelineState === "failed" || status?.pipelineState === "failed-with-stage-errors" || status?.pipelineState === "completed";
  const runningStep = statusClosed ? undefined : steps.find((step) => step.status === "running");
```

Then replace the `baseDetail` expression with:

```ts
  const baseDetail =
    currentStep?.progress?.detail ||
    currentStep?.progress?.label ||
    currentStep?.detail ||
    firstLine(status?.message) ||
    (completed ? "Daily pipeline finished." : "Daily pipeline is idle.");
```

This keeps current behavior, but because `currentStep` no longer uses stale running steps for closed statuses, the status message becomes the visible detail.

- [ ] **Step 4: Run frontend progress tests**

```powershell
npm run test -- src/dailySyncProgress.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/dailySyncProgress.ts src/dailySyncProgress.test.ts
git commit -m "fix: hide stale running sync progress after close"
```

---

### Task 4: PowerShell Child Process Capture

**Files:**
- Modify: `C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1`

- [ ] **Step 1: Add a reproducible local smoke command**

Before editing the wrapper, run this from `C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull` to reproduce the helper behavior with a harmless child process:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run_daily_spx_ibkr_sync_with_sheet_payload.ps1 --no-popup --date 2026-06-08 --run-id smoke-process-capture --option-sidecars-only --option-sidecar-scope no-such-scope
```

Expected before the fix: the wrapper may leave status in a warning/failed shape. This command should not touch IBKR because the scope is invalid and should fail fast in wrapper logic.

- [ ] **Step 2: Replace `Invoke-CapturedProcessWithLiveProgress` with synchronous polling capture**

In `run_daily_spx_ibkr_sync_with_sheet_payload.ps1`, replace the full `Invoke-CapturedProcessWithLiveProgress` function with:

```powershell
function Invoke-CapturedProcessWithLiveProgress {
    param(
        [string]$Command,
        [string[]]$CommandArgs = @(),
        [string]$WorkingDirectory = $ScriptDir,
        [int]$TimeoutSeconds = 0,
        [string]$ProgressPath = "",
        [string]$ProgressStepId = "",
        [int]$ProgressPollSeconds = 2,
        [scriptblock]$LineProgressHandler = $null
    )

    $Output = New-Object System.Collections.Generic.List[string]
    $StartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $StartInfo.FileName = $Command
    $StartInfo.WorkingDirectory = $WorkingDirectory
    $StartInfo.UseShellExecute = $false
    $StartInfo.RedirectStandardOutput = $true
    $StartInfo.RedirectStandardError = $true
    $StartInfo.Arguments = (($CommandArgs | ForEach-Object { Convert-ToProcessArgument ([string]$_) }) -join " ")

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $StartInfo
    [void]$Process.Start()
    $StartedAt = Get-Date
    $LastPollAt = (Get-Date).AddYears(-1)
    $TimedOut = $false

    while (-not $Process.HasExited) {
        $Now = Get-Date
        if ($ProgressPath -and (($Now - $LastPollAt).TotalSeconds -ge [Math]::Max(1, $ProgressPollSeconds))) {
            if (Update-SyncStepProgressFromFile -Path $ProgressPath -ExpectedStepId $ProgressStepId) {
                Write-RubiconSyncStatus -State "running" -Ok ($SyncHardFailures.Count -eq 0) -Message "Running $ProgressStepId."
            }
            $LastPollAt = $Now
        }
        if ($TimeoutSeconds -gt 0 -and (($Now - $StartedAt).TotalSeconds -ge $TimeoutSeconds)) {
            $TimedOut = $true
            try {
                $Process.Kill($true)
            }
            catch {
                try { $Process.Kill() } catch {}
            }
            break
        }
        Start-Sleep -Milliseconds 250
    }

    $StdOut = $Process.StandardOutput.ReadToEnd()
    $StdErr = $Process.StandardError.ReadToEnd()
    $Process.WaitForExit()

    foreach ($Line in ($StdOut -split "`r?`n")) {
        if ($Line) {
            [void]$Output.Add($Line)
            if ($LineProgressHandler) {
                try { [void](& $LineProgressHandler $Line) } catch {}
            }
        }
    }
    foreach ($Line in ($StdErr -split "`r?`n")) {
        if ($Line) {
            [void]$Output.Add($Line)
            if ($LineProgressHandler) {
                try { [void](& $LineProgressHandler $Line) } catch {}
            }
        }
    }

    if ($ProgressPath) {
        if (Update-SyncStepProgressFromFile -Path $ProgressPath -ExpectedStepId $ProgressStepId) {
            Write-RubiconSyncStatus -State "running" -Ok ($SyncHardFailures.Count -eq 0) -Message "Finished $ProgressStepId."
        }
    }

    return [pscustomobject]@{
        Output = @($Output.ToArray())
        ExitCode = if ($TimedOut) { 124 } else { $Process.ExitCode }
        TimedOut = $TimedOut
    }
}
```

Rationale: this keeps live progress via the progress JSON poll, avoids async output event handler fragility, and guarantees the wrapper waits for child process exit before returning.

- [ ] **Step 3: PowerShell parser check**

```powershell
$null = [System.Management.Automation.Language.Parser]::ParseFile(
  "C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1",
  [ref]$null,
  [ref]$errors
)
if ($errors.Count) { $errors | Format-List; exit 1 }
```

Expected: no parser errors.

- [ ] **Step 4: Harmless wrapper smoke**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run_daily_spx_ibkr_sync_with_sheet_payload.ps1 --no-popup --date 2026-06-08 --run-id smoke-process-capture --option-sidecars-only --option-sidecar-scope no-such-scope
```

Expected: wrapper exits normally, writes a final Rubicon status, does not leave a live Python child, and does not leave `data\daily_sync.lock.json` active.

- [ ] **Step 5: Commit**

```powershell
git add "C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1"
git commit -m "fix: make daily sync wrapper wait for child process"
```

---

### Task 5: Recover 2026-06-08 Payload and Google Upload

**Files:**
- No source changes.
- Data outputs:
  - `C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\data\ibkr_trades\2026-06-08\google_sheet_upload_payload.json`
  - `C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\data\ibkr_trades\2026-06-08\daily_sync_summary.json`

- [ ] **Step 1: Generate the missing tracker-only payload**

```powershell
python "C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\prepare_spx_google_sheet_upload.py" --date 2026-06-08 --tracker-only
```

Expected output includes:

```json
{
  "payload_path": "C:\\Users\\charl\\Desktop\\AI STUFF\\IBKR Equity History Pull\\data\\ibkr_trades\\2026-06-08\\google_sheet_upload_payload.json"
}
```

- [ ] **Step 2: Upload the tracker payload**

From `C:\Users\charl\Desktop\AI STUFF\spx-spread-replay-tracker`:

```powershell
npm run google:upload -- --date 2026-06-08 --payload "C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\data\ibkr_trades\2026-06-08\google_sheet_upload_payload.json" --run-id daily-2026-06-08-20260608200009
```

Expected: JSON with `ok:true`, `uploadMode:"tracker_only"`, and `dailySyncRunRow`.

- [ ] **Step 3: Refresh Google snapshot**

```powershell
npm run google:snapshot
```

If the script name differs, inspect `package.json` for the current Google snapshot command and run that exact command.

- [ ] **Step 4: Verify API status**

```powershell
$tracker = Invoke-RestMethod -Uri "http://127.0.0.1:5174/api/tracker" -TimeoutSec 15
$day = $tracker.dailySummaries | Where-Object { $_.date -eq "2026-06-08" } | Select-Object -First 1
$day | Select-Object date,uploadStatus,issueCount,tradeCount,entryCount,spreadMarkRowCount
```

Expected:

```text
date              : 2026-06-08
uploadStatus      : uploaded
issueCount        : 0
tradeCount        : 223
entryCount        : 17
spreadMarkRowCount: 82620
```

- [ ] **Step 5: Do not commit generated local data unless explicitly requested**

The payload and summary artifacts are runtime data, not source. Leave them uncommitted unless the operator specifically asks to version them.

---

### Task 6: Validation Gate

**Files:**
- All touched source/test files.

- [ ] **Step 1: Run focused tests**

```powershell
npm run test -- server/dailySync.test.ts src/dailySyncProgress.test.ts
```

Expected: pass.

- [ ] **Step 2: Run typecheck**

```powershell
npm run typecheck
```

Expected: pass. If it fails on unrelated in-flight frontend edits, record the exact pre-existing file/error and still run the focused tests above.

- [ ] **Step 3: Run build if source changes are clean**

```powershell
npm run build
```

Expected: pass, allowing the existing Vite large-chunk warning.

- [ ] **Step 4: API smoke**

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:5174/api/daily-sync/status" -TimeoutSec 5 |
  Select-Object ok,state,pipelineState,reviewReady,googleUploaded,runId,finishedAt
```

Expected after code fix and payload/upload recovery:

```text
ok            : True
state         : completed
pipelineState : completed
reviewReady   : True
googleUploaded: True
```

If payload/upload is not recovered yet, expected:

```text
ok            : True
state         : completed
pipelineState : failed-with-stage-errors
reviewReady   : True
googleUploaded: False
```

---

## Self-Review

- Spec coverage: The plan covers the three observed failures: stale status, wrapper exit handling, and missing Google payload/upload.
- Placeholder scan: No `TBD`, vague "handle edge cases", or "write tests" placeholders remain.
- Type consistency: The plan uses existing types and functions: `DailySyncStatusResult`, `DailyPipelineStages`, `DailySyncStep`, `mergeDailySyncCompletionStatus`, `pipelineStateFromStages`, and `buildDailySyncProgress`.
- Risk note: The repo already has unrelated modified frontend files. Implementation must not overwrite those changes.
