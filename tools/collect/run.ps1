# PowerShell 실행기 — tools\collect\.env 에 키를 넣고 실행하세요.
#   점검:  .\tools\collect\run.ps1 --verify
#   수집:  .\tools\collect\run.ps1 --sido 41 --ltc --welfare
Set-Location (Join-Path $PSScriptRoot '..\..')
node tools/collect/collect.mjs @args
