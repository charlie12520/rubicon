Option Explicit

' Godel news watcher logon launcher.
' Starts scripts/godel-news-scraper.mjs with NO console window, via WMI
' Win32_Process.Create with ShowWindow=SW_HIDE — the same trick as
' serve-headless.vbs ("Rubicon Server" task). Safe to double-fire: the
' scraper's own single-instance lock (godel-news/watcher.lock.json) makes a
' second copy exit immediately. The scraper logs to godel-news/watcher.log.

Dim fso, shell
Dim scriptDir, appRoot, scraperPath, nodeExe, nodeCmd
Dim wmiService, startup, processClass, processId, wmiSucceeded

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appRoot = fso.GetParentFolderName(scriptDir)
scraperPath = fso.BuildPath(scriptDir, "godel-news-scraper.mjs")

nodeExe = FindNodeExe()
nodeCmd = Quote(nodeExe) & " " & Quote(scraperPath)

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
