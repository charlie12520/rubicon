# Rubicon Server Recovery Runbook

Use this only when the installed Rubicon desktop app opens to "refused to connect" or the user asks to recover the live Rubicon server.

This is runtime recovery, not a code task. Do not edit files, create a task, change branches, run app tests or builds, or touch TWS, Godel, Edge, or any live feed process. Kill nothing unless it is an exact PID you started and the user approves.

## Target

- Working directory: `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker`
- App URL: `http://127.0.0.1:5174/`
- Health URL: `http://127.0.0.1:5174/api/health`
- Expected health JSON includes `ok: true` and `app: "rubicon"`.
- Launcher: `C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\scripts\serve-headless.vbs`

## Recovery Steps

First check whether the server is already running:

```powershell
Set-Location "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker"

Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue
Invoke-WebRequest -Uri "http://127.0.0.1:5174/api/health" -UseBasicParsing -TimeoutSec 3
```

If `/api/health` returns JSON with `ok: true` and `app: "rubicon"`, do not start another server. Tell the user the server is up and to refresh or reopen the Rubicon app.

If nothing is listening on port `5174`, start the same headless launcher used at logon:

```powershell
Start-Process `
  -FilePath "C:\Windows\System32\wscript.exe" `
  -ArgumentList '//B "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\scripts\serve-headless.vbs"' `
  -WorkingDirectory "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker" `
  -WindowStyle Hidden
```

Wait 5 to 10 seconds, then verify:

```powershell
Start-Sleep -Seconds 8
Invoke-WebRequest -Uri "http://127.0.0.1:5174/api/health" -UseBasicParsing -TimeoutSec 5
Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue
```

If health passes, report the server URL and ask the user to refresh or reopen the Rubicon app:

```text
http://127.0.0.1:5174/
```

## Failure Handling

If port `5174` is occupied but `/api/health` is not Rubicon, do not kill anything automatically. Report the owning PID and command line:

```powershell
$connection = Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($connection) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" |
    Select-Object ProcessId,Name,CommandLine
}
```

If the launcher runs but health still fails, inspect only these logs:

```powershell
Get-Content "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\serve-headless.log" -Tail 80
Get-Content "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\serve-headless-server.out.log" -Tail 80
Get-Content "C:\Users\charl\Desktop\Rubicon\spx-spread-replay-tracker\data\serve-headless-server.err.log" -Tail 80
```

Do not kill or restart TWS, Godel, Edge, or any existing live feed process. Do not run app tests, builds, Git commands beyond a narrow status check, or repo edits for this recovery.

## Success Criteria

- `GET http://127.0.0.1:5174/api/health` returns `ok: true` and `app: "rubicon"`.
- Exactly one listener is present on port `5174`.
- The user is told to refresh or reopen the Rubicon app.
