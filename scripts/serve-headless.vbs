Option Explicit

' Rubicon headless server launcher.
' Starts the single Express API/server (tsx server/index.ts) with NO console
' window, via WMI Win32_Process.Create with ShowWindow=SW_HIDE — the same
' bulletproof trick used by launch-desktop.vbs. Used by the "Rubicon Server"
' logon Scheduled Task. The server's own pre-bind probe (server/index.ts)
' guarantees only one instance survives, so it is safe even if another launch
' path also fires at logon. This launcher does NOT open a browser — the window
' is the installed Edge PWA pointed at http://127.0.0.1:5174/.

Dim fso, shell
Dim scriptDir, appRoot, tsxPath, nodeExe, nodeCmd
Dim wmiService, startup, processClass, processId, wmiSucceeded

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appRoot = fso.GetParentFolderName(scriptDir)
' serve-headless.mjs rebuilds a stale dist first (build failures fall back to
' the existing dist), then starts tsx server/index.ts detached.
tsxPath = fso.BuildPath(scriptDir, "serve-headless.mjs")

nodeExe = FindNodeExe()
nodeCmd = Quote(nodeExe) & " " & Quote(tsxPath)

' Primary path: WMI Win32_Process.Create with SW_HIDE — no console at all.
wmiSucceeded = False
On Error Resume Next
Set wmiService = GetObject("winmgmts:\\.\root\cimv2")
If Err.Number = 0 Then
  Set startup = wmiService.Get("Win32_ProcessStartup").SpawnInstance_
  startup.ShowWindow = 0
  Set processClass = wmiService.Get("Win32_Process")
  processClass.Create nodeCmd, appRoot, startup, processId
  If Err.Number = 0 Then
    wmiSucceeded = True
  End If
End If
On Error Goto 0

' Fallback: shell.Run with hide flag (less reliable on Win11 but still tries).
If Not wmiSucceeded Then
  shell.CurrentDirectory = appRoot
  shell.Run nodeCmd, 0, False
End If

Function FindNodeExe()
  Dim pathVar, dirs, dir, candidate, fso2
  Set fso2 = CreateObject("Scripting.FileSystemObject")
  pathVar = shell.Environment("Process").Item("PATH")
  dirs = Split(pathVar, ";")
  For Each dir In dirs
    If Len(dir) > 0 Then
      candidate = fso2.BuildPath(dir, "node.exe")
      If fso2.FileExists(candidate) Then
        FindNodeExe = candidate
        Exit Function
      End If
    End If
  Next
  FindNodeExe = "node.exe"
End Function

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
