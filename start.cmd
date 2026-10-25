@echo off
rem Double-click to start NeuroChat on Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
