@echo off
REM 윈도우 명령창용 실행기 — tools\collect\.env 에 키를 넣고 실행하세요.
REM   점검:  tools\collect\run.cmd --verify
REM   수집:  tools\collect\run.cmd --sido 41 --ltc --welfare
setlocal
cd /d "%~dp0\..\.."
node tools\collect\collect.mjs %*
endlocal
