@echo off
rem Double-click this file to start PulseCut and keep it running.
rem The watchdog starts hidden, restarts the API/web server if either stops,
rem and opens the studio in the browser.
start "" wscript.exe "%~dp0PulseCut Watchdog.vbs"
exit /b 0
