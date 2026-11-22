' Keeps PulseCut running. Starts the API and web server if either is down,
' checks every 10 seconds, and exits if another watchdog is already active.
' Safe to launch repeatedly: a running watchdog is detected via a heartbeat.
Option Explicit

Dim fso, sh, root, dataDir, logDir, apiLog, webLog, lockFile, previous, age

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
dataDir = root & "data"
logDir = sh.ExpandEnvironmentStrings("%TEMP%")
apiLog = logDir & "\pulsecut-api.log"
webLog = logDir & "\pulsecut-web.log"
lockFile = dataDir & "\pulsecut-watchdog.heartbeat"

If Not fso.FolderExists(dataDir) Then fso.CreateFolder dataDir

If fso.FileExists(lockFile) Then
  Dim ts
  Set ts = fso.OpenTextFile(lockFile, 1, False)
  previous = Trim(ts.ReadAll)
  ts.Close
  If IsDate(previous) Then
    age = DateDiff("s", CDate(previous), Now)
    If age >= 0 And age < 30 Then
      OpenStudio
      WScript.Quit
    End If
  End If
End If

sh.CurrentDirectory = root
WriteHeartbeat
If EnsureServers Then WScript.Sleep 5000
OpenStudio

Do
  WScript.Sleep 10000
  EnsureServers
  WriteHeartbeat
Loop

Function EnsureServers()
  Dim started
  started = False
  If Not IsListening(8790) Then
    sh.Run "cmd /c node server/index.js > """ & apiLog & """ 2>&1", 0, False
    started = True
  End If
  If Not IsListening(5190) Then
    sh.Run "cmd /c node ..\..\node_modules\vite\bin\vite.js --port 5190 --strictPort > """ & webLog & """ 2>&1", 0, False
    started = True
  End If
  EnsureServers = started
End Function

Sub WriteHeartbeat()
  Dim out
  Set out = fso.OpenTextFile(lockFile, 2, True)
  out.Write CStr(Now)
  out.Close
End Sub

Sub OpenStudio()
  sh.Run "http://localhost:5190", 1, False
End Sub

Function IsListening(port)
  Dim proc, line, found
  found = False
  Set proc = sh.Exec("netstat -ano -p tcp")
  Do While Not proc.StdOut.AtEndOfStream
    line = proc.StdOut.ReadLine()
    If InStr(line, ":" & port & " ") > 0 And InStr(line, "LISTENING") > 0 Then
      found = True
    End If
  Loop
  IsListening = found
End Function
