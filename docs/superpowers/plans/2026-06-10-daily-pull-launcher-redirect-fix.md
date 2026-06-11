# Daily Pull Launcher Redirect Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Rubicon's full Daily Pull launch the PowerShell wrapper reliably again while keeping the wrapper independent of Rubicon server restarts.

**Architecture:** Keep `buildDailySyncCommand()` as the user-visible wrapper command. Add a focused launcher helper that wraps that command in an encoded PowerShell command with `*>> daily-sync-launch.log` redirection, then spawn that helper detached with ignored stdio. This avoids the Windows numeric-file-descriptor stdio path that produced the June 10 immediate `exit 0` with no wrapper output.

**Tech Stack:** Node/Express backend, TypeScript, Vitest, Windows PowerShell 5.1.

---

### Task 1: Regression Test For Detached Redirect Launch

**Files:**
- Modify: `server/dailySync.test.ts`
- Modify: `server/dailySync.ts`

- [ ] **Step 1: Write the failing test**

Add an import for the new helper and a test that decodes the generated `-EncodedCommand`:

```ts
import { buildDailySyncCommand, buildDailySyncProcessLaunch, ... } from "./dailySync.ts";

it("launches full daily sync through PowerShell redirection instead of inherited file descriptors", () => {
  const wrapper = buildDailySyncCommand({ date: "2026-06-10", runId: "daily-test" });
  const launch = buildDailySyncProcessLaunch(wrapper, "C:\\logs\\daily-sync-launch.log");
  const encodedIndex = launch.args.indexOf("-EncodedCommand");
  const decoded = Buffer.from(launch.args[encodedIndex + 1], "base64").toString("utf16le");

  expect(launch.command).toBe("powershell.exe");
  expect(launch.detached).toBe(true);
  expect(launch.stdio).toBe("ignore");
  expect(decoded).toContain("& '");
  expect(decoded).toContain("run_daily_spx_ibkr_sync_with_sheet_payload.ps1");
  expect(decoded).toContain("'--date'");
  expect(decoded).toContain("'2026-06-10'");
  expect(decoded).toContain("'--run-id'");
  expect(decoded).toContain("'daily-test'");
  expect(decoded).toContain("*>> 'C:\\logs\\daily-sync-launch.log'");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
npm run test -- server/dailySync.test.ts
```

Expected: fail because `buildDailySyncProcessLaunch` is not exported yet.

### Task 2: Implement The Redirected Launcher

**Files:**
- Modify: `server/dailySync.ts`

- [ ] **Step 1: Add launcher types and quoting helper**

Add a `DailySyncProcessLaunch` type with `command`, `args`, `cwd`, `display`, `detached`, and `stdio`. Add `quotePowerShellLiteral(value)` that returns a single-quoted PowerShell literal and doubles embedded single quotes.

- [ ] **Step 2: Add `buildDailySyncProcessLaunch()`**

The helper should:

```ts
export function buildDailySyncProcessLaunch(command: DailySyncCommand, logPath = DAILY_SYNC_LAUNCH_LOG): DailySyncProcessLaunch {
  const invocation = [`& ${quotePowerShellLiteral(command.command)}`, ...command.args.map(quotePowerShellLiteral)].join(" ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${quotePowerShellLiteral(command.cwd)}`,
    `${invocation} *>> ${quotePowerShellLiteral(logPath)}`,
  ].join("\r\n");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    cwd: command.cwd,
    display: command.display,
    detached: true,
    stdio: "ignore",
  };
}
```

- [ ] **Step 3: Replace only the full Daily Pull spawn path**

In `startDailySync()`, build `const processLaunch = buildDailySyncProcessLaunch(command);` and spawn `processLaunch.command/processLaunch.args` with `detached: processLaunch.detached` and `stdio: processLaunch.stdio`. Keep `child.unref()` so a Rubicon restart cannot keep the server process tied to the wrapper.

Do not change `startDailyOptionPull()`: it uses the older piped path and was not the June 10 failure.

### Task 3: Verification And Docs

**Files:**
- Modify: `WORKLOG.md`
- Modify: `naive_acceptance.md` if assigning a new acceptance row is appropriate.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npm run test -- server/dailySync.test.ts
```

Expected: pass.

- [ ] **Step 2: Run broader safe checks**

Run:

```powershell
npm run typecheck
npm run build
$path='C:\Users\charl\Desktop\AI STUFF\IBKR Equity History Pull\run_daily_spx_ibkr_sync_with_sheet_payload.ps1'; $tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$tokens,[ref]$errors) > $null; if ($errors.Count) { $errors | ForEach-Object { $_.ToString() } } else { 'PARSER_OK' }
```

Expected: typecheck/build pass; wrapper parser reports `PARSER_OK`.

- [ ] **Step 3: Document proof**

Append a short WORKLOG entry for A179: June 10 full Daily Pull failed before wrapper output because the detached numeric-fd launcher path exited immediately; full Daily Pull now launches through encoded PowerShell redirection while option retry remains unchanged. Include the commands run.

### Self-Review

- Spec coverage: fixes the Daily Pull start path, preserves server-restart independence, avoids API/route changes, and does not touch option-data retry logic.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: `DailySyncCommand` remains the visible command contract; `DailySyncProcessLaunch` is only the internal process-launch contract.
