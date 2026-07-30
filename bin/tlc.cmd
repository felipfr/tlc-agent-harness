@echo off
setlocal
node "%~dp0tlc-exec.mjs" tlc-cli %*
exit /b %ERRORLEVEL%
