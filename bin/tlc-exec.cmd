@echo off
setlocal
node "%~dp0tlc-exec.mjs" %*
exit /b %ERRORLEVEL%
