@echo off
rem Stops the PulseCut watchdog and the API/web servers it manages.
powershell.exe -NoProfile -WindowStyle Hidden -Command "$ports = 8790,5190; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'wscript.exe' -and $_.CommandLine -like '*Watchdog*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; Remove-Item '%~dp0data\pulsecut-watchdog.heartbeat' -Force -ErrorAction SilentlyContinue"
echo PulseCut stopped.
