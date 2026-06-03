Option Explicit

Dim args
Dim body
Dim detail
Dim message
Dim shell
Dim timeoutSeconds
Dim title

Set args = WScript.Arguments
title = "Rubicon Calendar Alert"
body = "Calendar event starts soon."
detail = ""
timeoutSeconds = 12

If args.Count > 0 Then
  title = args(0)
End If

If args.Count > 1 Then
  body = args(1)
End If

If args.Count > 2 Then
  detail = args(2)
End If

If args.Count > 3 Then
  On Error Resume Next
  timeoutSeconds = CInt(args(3))
  If Err.Number <> 0 Or timeoutSeconds < 1 Then
    timeoutSeconds = 12
    Err.Clear
  End If
  On Error GoTo 0
End If

message = body
If Len(detail) > 0 Then
  message = message & vbCrLf & vbCrLf & detail
End If

Set shell = CreateObject("WScript.Shell")
shell.Popup message, timeoutSeconds, title, 4096 + 64
