' Legacy launcher. Delegates to the watchdog so every start path keeps
' PulseCut running and restarts the API/web server if either stops.
Option Explicit

Dim sh, root, watchdog
Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
watchdog = root & "PulseCut Watchdog.vbs"
sh.Run """C:\Windows\System32\wscript.exe"" """ & watchdog & """", 0, False
