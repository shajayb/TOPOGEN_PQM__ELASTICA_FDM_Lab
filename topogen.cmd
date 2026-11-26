@echo off
setlocal
node "%~dp0TOPOGEN_FDM_Foundry\cli\topogen.mjs" %*
exit /b %ERRORLEVEL%
