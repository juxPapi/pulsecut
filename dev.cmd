@echo off
rem Interactive dev mode: keeps both servers attached to this terminal window.
rem npm.cmd is used because plain npm is a PowerShell script and the machine's
rem execution policy is Restricted.
call npm.cmd run dev
