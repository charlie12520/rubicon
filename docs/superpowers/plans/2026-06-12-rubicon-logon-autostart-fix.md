# Rubicon logon autostart fix — handoff plan (2026-06-12)

> For Opus. Diagnosis below is complete and read-only-verified; execute the fix tasks.
> HARD CONSTRAINT: it is a market day — do NOT kill or restart the live server (pid chain
> 52208→22180 on 127.0.0.1:5174) before ~16:05 ET. Every task below is restart-free.

## Symptom

User: "Rubicon suddenly refusing to connect on 127.0.0.1."

## Verified diagnosis (all evidence checked 2026-06-12 ~13:05 ET)

1. The PC was **powered off at 04:29 AM** (System event 1074, winlogon, user-initiated) and
   **turned on at 12:18 PM** (Win32_OperatingSystem.LastBootUpTime).
2. At the 12:18 logon, Startup-folder items fired normally (Godel watcher node up at 12:20,
   Rubicon PWA auto-opened) — but the **"\Rubicon Server" scheduled task did NOT fire**:
   its Last Run Time is **12:53:50 PM** (the manual kick), not 12:18. From 12:18→12:53 nothing
   listened on 127.0.0.1:5174 → the auto-opened PWA showed connection refused. That is the
   entire user-visible symptom.
3. The task XML is structurally fine (LogonTrigger for DRIVER\charl, enabled by default, no
   battery condition, StartWhenAvailable true). Task Scheduler operational history is DISABLED
   on this machine, so the internal reason the trigger skipped cannot be recovered post-hoc.
   Treat the logon trigger as unreliable; do not burn time root-causing Windows internals.
4. At 12:53 the task was run manually (spawned server pid 49748); at ~12:55 a second server was
   started manually from a shell. They briefly raced (the `clientId 884 already in use` +
   TWS-refused noise in `data/serve-headless-server.err.log` — TWS itself was still booting).
   The task-spawned instance is dead; the surviving server (node 22180, parent tsx 52208,
   started 12:55) is healthy: `GET /api/health` → 200, single LISTEN socket on 127.0.0.1:5174.
5. **Collateral: today's live feeds are OFF.** The server booted at 12:55, far past the
   09:25/09:28 auto-start windows, and by design a midday boot does not spawn pollers.
   Confirmed: spx-live-bars / spx-heatmap / spread-speed all report `running:false,
   "auto-start armed for 09:28 ET"`. TWS is NOW reachable (7496 listening), so the feeds can
   be armed manually.

## Fix tasks

### T1 — Arm today's feeds now (user-visible recovery, do first)

The manual start endpoints exist for exactly this. From any shell:

```powershell
Invoke-RestMethod -Method Post "http://127.0.0.1:5174/api/spx-live-bars/live/start"
Invoke-RestMethod -Method Post "http://127.0.0.1:5174/api/spx-heatmap/live/start"
Invoke-RestMethod -Method Post "http://127.0.0.1:5174/api/qqq-heatmap/live/start"
Invoke-RestMethod -Method Post "http://127.0.0.1:5174/api/spread-speed/live/start"
```

Also grep `server/index.ts` for any other `/live/start` routes (FPL's status route is not at
`/api/fpl/live/status` — find its real path) and start whatever applies during RTH.
Validate: each corresponding `/live/status` flips to `running:true` and its logTail advances;
the Morning heatmap/estimator panels show fresh timestamps within ~1–2 min.

### T2 — Belt-and-suspenders autostart (the durable fix)

Add a **Startup-folder shortcut** for the server, exactly like the proven Godel-watcher one
(Startup items demonstrably fire at this machine's logons; the scheduled task does not always).
Double-fire with the existing task is SAFE BY DESIGN: serve-headless's server does a pre-bind
probe and exits 0 if 5174 is owned, and the task itself is MultipleInstancesPolicy=IgnoreNew.

```powershell
$startup = [Environment]::GetFolderPath("Startup")
$vbs = "C:\Users\charl\Desktop\AI STUFF\spx-spread-replay-tracker\scripts\serve-headless.vbs"
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $startup "Rubicon Server.lnk"))
$lnk.TargetPath = "C:\Windows\System32\wscript.exe"
$lnk.Arguments = "//B `"$vbs`""
$lnk.WorkingDirectory = "C:\Users\charl\Desktop\AI STUFF\spx-spread-replay-tracker"
$lnk.Description = "Starts the Rubicon server hidden at logon (backup for the scheduled task)"
$lnk.Save()
```

Keep the scheduled task in place (harmless redundancy). Validate WITHOUT restarting the live
server: fire the shortcut now (`Invoke-Item` it) and confirm the spawned instance logs the
port-owned clean exit in `data/serve-headless.log` while pid 22180 keeps serving — that proves
the idempotence path. Full end-to-end proof happens at the next real reboot (after hours).

### T3 — Enable Task Scheduler history (optional, needs elevation)

So the next trigger no-show is diagnosable: `wevtutil sl Microsoft-Windows-TaskScheduler/Operational /e:true`
(skip silently if elevation isn't available).

### T4 — Ledger + docs

Per AGENTS.md §3: claim the next acceptance ID (A192 if free — read the yaml fresh; concurrent
sessions are active), WORKLOG entry, commit only your files. Note in the WORKLOG entry that the
PWA may still need one manual reload after any logon where it opens before the server binds
(known cosmetic race, not fixed here).

## Out of scope (deliberately)

- No server restart, no changes to server/index.ts or serve-headless.* — the running system is
  healthy and it's RTH.
- The 12:53–12:55 dual-instance race and the clientId-884 boot-refresh collision are transient
  cosmetics of the manual recovery, already self-resolved.
