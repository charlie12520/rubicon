Option Explicit

' Rubicon launcher — bulletproof silent launch via WMI Win32_Process.Create.
' Two reinforcing protections:
'   1. WMI ShowWindow=SW_HIDE creates node.exe with no allocated console window
'      (intWindowStyle=0 via shell.Run is not reliable on Windows 11).
'   2. Sets RUBICON_SKIP_DESKTOP_BUILD and RUBICON_REUSE_READY_SERVER so the mjs
'      launcher skips the npm-build and powershell-based restart paths that
'      would otherwise flash console windows.

Dim fso, shell
Dim scriptDir, appRoot, mjsPath, nodeExe, nodeCmd
Dim wmiService, startup, processClass, processId
Dim wmiSucceeded

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appRoot = fso.GetParentFolderName(scriptDir)
mjsPath = fso.BuildPath(scriptDir, "silent-launch.mjs")

' Reinforce skip-flags in process env (in case User registry hasn't propagated).
' shell.Environment("Process") only affects this wscript; WMI children inherit
' from the user logon's env, but shell.Run children inherit from this process.
shell.Environment("Process").Item("RUBICON_SKIP_DESKTOP_BUILD") = "1"
shell.Environment("Process").Item("RUBICON_REUSE_READY_SERVER") = "1"

nodeExe = FindNodeExe()
nodeCmd = Quote(nodeExe) & " " & Quote(mjsPath)

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
