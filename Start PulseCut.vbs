' PulseCut launcher. Starts the API and web servers as hidden, detached
' processes and opens the studio in the browser. Safe to run more than once:
' servers that are already listening are left alone.
Option Explicit

Dim sh, root, logDir, apiLog, webLog

Set sh = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
logDir = sh.ExpandEnvironmentStrings("%TEMP%")
apiLog = logDir & "\pulsecut-api.log"
webLog = logDir & "\pulsecut-web.log"

sh.CurrentDirectory = root

If Not IsListening(8790) Then
    sh.Run "cmd /c node server/index.js > """ & apiLog & """ 2>&1", 0, False
End If

If Not IsListening(5190) Then
    sh.Run "cmd /c node ..\..\node_modules\vite\bin\vite.js --port 5190 --strictPort > """ & webLog & """ 2>&1", 0, False
End If

' Give the servers a moment to bind before opening the browser.
WScript.Sleep 5000
sh.Run "http://localhost:5190", 1, False

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
