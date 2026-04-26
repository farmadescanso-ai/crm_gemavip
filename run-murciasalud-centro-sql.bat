@echo off
rem Lanzador en la raiz del repo: en PowerShell usa .\run-murciasalud-centro-sql.bat "URL"
cd /d "%~dp0"
call "%~dp0scripts\run-murciasalud-centro-sql.bat" %*
