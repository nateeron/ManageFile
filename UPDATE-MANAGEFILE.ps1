# Run from PowerShell on Windows. SSH passwords are never saved by this script.
[CmdletBinding()]
param(
    [string]$Server = 'root@managefile.cayoshibot.com',
    [string]$RemoteRoot = '/root/Web_ManageFile2027',
    [string]$Service = 'Web_ManageFile2027.service',
    [string]$Python = '/root/Web_ManageFile2027/venv/bin/python3',
    [switch]$CheckOnly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
if ($Server -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$') { throw 'Invalid SSH server.' }
if ($Service -notmatch '^[A-Za-z0-9_.@-]+\.service$') { throw 'Invalid service name.' }
foreach ($remotePath in @($RemoteRoot, $Python)) {
    if ($remotePath -notmatch '^/[A-Za-z0-9_./-]+$' -or $remotePath -match '(^|/)\.\.(/|$)') { throw 'Use an absolute Linux path without spaces or parent traversal.' }
}
$RemoteRoot = $RemoteRoot.TrimEnd('/')
if ($RemoteRoot -eq '' -or $RemoteRoot -in @('/root','/home','/etc','/usr','/var')) { throw 'RemoteRoot must be the application directory.' }
$requiredFiles = @(
    'app.py','auth_system.py','terminal_system.py','monitor_system.py','web_monitor.py','requirements.txt',
    'templates/index.html','templates/auth.html','templates/terminal.html','templates/terminal-panel.html','templates/monitor.html',
    'static/style.css','static/style_inline.css','static/style_imageZoom.css','static/style_Drag_Coverage.css',
    'static/explorer-ui.css','static/auth.css','static/monitor.css','static/script.js','static/script_inline.js',
    'static/script_Drag_Coverage.js','static/java_imagezoom.js','static/jquery-3.7.1.min.js','static/explorer-ui.js',
    'static/auth-client.js','static/terminal.js','static/chat.js','static/monitor.js','static/web-monitor.js'
)
$manifest = foreach ($relativeFile in $requiredFiles) {
    $localFile = Join-Path $sourceRoot $relativeFile
    if (-not (Test-Path -LiteralPath $localFile -PathType Leaf)) { throw "Missing required file: $localFile" }
    $hash = (Get-FileHash -LiteralPath $localFile -Algorithm SHA256).Hash.ToLowerInvariant()
    '{0}  {1}' -f $hash, $relativeFile
}
Write-Host "Source: $sourceRoot"
Write-Host "Target: ${Server}:$RemoteRoot"
Write-Host "Service: $Service"
Write-Host "Python: $Python"
Write-Host "Validated $($requiredFiles.Count) required files."
if ($CheckOnly) {
    Write-Host 'CHECK ONLY: No SSH, upload or server changes were performed.' -ForegroundColor Green
    exit 0
}
Get-Command ssh -ErrorAction Stop | Out-Null
Get-Command scp -ErrorAction Stop | Out-Null
function Invoke-SSH([string]$Command) {
    & ssh $Server $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH command failed (exit $LASTEXITCODE). Update stopped." }
}
$updateId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$remoteStage = "/tmp/managefile-update-$updateId"
$manifestFolder = Join-Path ([IO.Path]::GetTempPath()) "managefile-update-$updateId"
New-Item -ItemType Directory -Path $manifestFolder | Out-Null
$manifestFile = Join-Path $manifestFolder 'SHA256SUMS'
[IO.File]::WriteAllText($manifestFile, (($manifest -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
# Use normal OpenSSH authentication and host-key verification.
Invoke-SSH "set -eu; test -d '$RemoteRoot'; test -x '$Python'; systemctl cat '$Service' >/dev/null; mkdir -p '$remoteStage/templates' '$remoteStage/static'; printf 'Current service command: '; systemctl show '$Service' --property=ExecStart --value"
foreach ($prefix in @('', 'templates/', 'static/')) {
    $localFiles = @($requiredFiles | Where-Object {
        if ($prefix -eq '') { $_ -notlike '*/*' } else { $_.StartsWith($prefix) }
    } | ForEach-Object { Join-Path $sourceRoot $_ })
    if ($prefix -eq '') { $localFiles += $manifestFile }
    & scp -- @localFiles "${Server}:$remoteStage/$prefix"
    if ($LASTEXITCODE -ne 0) { throw "Upload failed for group '$prefix'. Live code has not been installed." }
}
$remoteScript = @'
set -eu
root='__ROOT__'
stage='__STAGE__'
service='__SERVICE__'
python='__PYTHON__'
cd "$stage"
echo 'Verify uploaded files:'
sha256sum -c SHA256SUMS
"$python" -m py_compile app.py auth_system.py terminal_system.py monitor_system.py web_monitor.py
execstart=$(systemctl show "$service" --property=ExecStart --value)
case "$execstart" in
  *"$root/app.py"*) ;;
  *) echo 'Service ExecStart does not point to the target app.py. Update stopped.' >&2; exit 1 ;;
esac
case "$execstart" in
  *"$python"*) ;;
  *) echo 'Python differs from Service ExecStart. Re-run with -Python set to the service interpreter path.' >&2; exit 1 ;;
esac
backup="$root/BackUp_/deploy-__ID__"
mkdir -p "$backup"
while read -r checksum relative; do
  if [ -e "$root/$relative" ]; then
    mkdir -p "$backup/$(dirname "$relative")"
    cp -p "$root/$relative" "$backup/$relative"
  fi
done < SHA256SUMS
"$python" -m pip install -r "$stage/requirements.txt"
recover() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "Update failed. Code backup: $backup" >&2
    systemctl start "$service" || true
    journalctl -u "$service" -n 35 --no-pager || true
  fi
}
trap recover EXIT
systemctl stop "$service"
while read -r checksum relative; do
  mkdir -p "$root/$(dirname "$relative")"
  cp -p "$stage/$relative" "$root/$relative"
done < SHA256SUMS
cd "$root"
echo 'Verify installed files:'
sha256sum -c "$stage/SHA256SUMS"
systemctl start "$service"
ready=0
for attempt in 1 2 3 4 5; do
  sleep 2
  if systemctl is-active --quiet "$service"; then ready=$((ready + 1)); else ready=0; fi
done
if [ "$ready" -lt 2 ]; then
  echo 'Service did not stay active. Inspect the journal output.' >&2
  exit 1
fi
systemctl status "$service" --no-pager -l
journalctl -u "$service" -n 20 --no-pager
echo "UPDATE COMPLETE - 29 file checksums verified. Backup: $backup"
'@
$remoteScript = $remoteScript.Replace('__ROOT__',$RemoteRoot).Replace('__STAGE__',$remoteStage).Replace('__SERVICE__',$Service).Replace('__PYTHON__',$Python).Replace('__ID__',$updateId).Replace("`r",'')
$encodedScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteScript))
Invoke-SSH "printf '%s' '$encodedScript' | base64 -d | bash"
Write-Host 'Update completed. Open /monitor and press Ctrl+F5.' -ForegroundColor Green
Write-Host "Server backup: $RemoteRoot/BackUp_/deploy-$updateId"
