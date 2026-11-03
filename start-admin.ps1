# Run locally on the Windows server. Windows displays its normal UAC prompt.
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$managefilePort = if ($env:MANAGEFILE_PORT) { [int]$env:MANAGEFILE_PORT } else { 2289 }
if (Get-NetTCPConnection -State Listen -LocalPort $managefilePort -ErrorAction SilentlyContinue) {
    throw "Port $managefilePort is already in use. Stop the existing ManageFile server before running start-admin.ps1."
}
$pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
$appPath = Join-Path $projectRoot 'app.py'
$arguments = '"' + $appPath + '"'
try {
    Start-Process -FilePath $pythonPath -ArgumentList $arguments -WorkingDirectory $projectRoot -Verb RunAs -WindowStyle Hidden -PassThru | Out-Null
    Write-Output "ManageFile started in administrator mode. Open http://127.0.0.1:$managefilePort/ in your browser."
} catch {
    throw 'Administrator startup was cancelled or failed. Approve the Windows UAC prompt to use administrator commands.'
}
