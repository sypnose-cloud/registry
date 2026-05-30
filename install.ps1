<#
  Sypnose Registry - one-command installer (Windows)
  Installs a live, auto-updating code+API+DB registry for any repo.
  Usage:
    $env:REGISTRY_REPO="C:/path/to/repo"; irm https://raw.githubusercontent.com/sypnose-cloud/registry/main/install.ps1 | iex
    (or run the script and it prompts for the repo path)
#>
$ErrorActionPreference = "Stop"
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ Write-Host "[ERR]  $m" -ForegroundColor Red; exit 1 }

Write-Host "=== Sypnose Registry Installer (Windows) ===" -ForegroundColor Cyan

$Repo = $env:REGISTRY_REPO
if (-not $Repo) { $Repo = Read-Host "Path to the repo you want to index" }
if (-not (Test-Path $Repo)) { Fail "Repo path does not exist: $Repo" }
$Repo = (Resolve-Path $Repo).Path -replace '\\','/'
Ok "Indexing repo: $Repo"

$Port = if ($env:REGISTRY_PORT) { $env:REGISTRY_PORT } else { "7008" }
$GhRepo = "sypnose-cloud/registry"
$InstallDir = Join-Path $env:USERPROFILE ".registry"
$SvcDir = Join-Path $InstallDir "backstage-api"

# 1. Prereqs
Info "Checking prerequisites..."
foreach ($c in @("node","npm","git")) {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Fail "$c required. Install it first." }
}
Ok "Node/npm/git present."

# 2. trace-mcp
if (-not (Get-Command trace-mcp -ErrorAction SilentlyContinue)) {
  Info "Installing trace-mcp (npm -g)..."
  npm install -g trace-mcp 2>&1 | Select-Object -Last 1
}

# 3. Get API code
Info "Fetching registry API code..."
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$Tmp = Join-Path $env:TEMP "registry-clone-$(Get-Random)"
git clone --depth 1 "https://github.com/$GhRepo.git" $Tmp 2>&1 | Out-Null
if (-not (Test-Path "$Tmp/backstage-api")) { Fail "clone failed or missing backstage-api" }
if (Test-Path $SvcDir) { Remove-Item -Recurse -Force $SvcDir }
Copy-Item -Recurse "$Tmp/backstage-api" $SvcDir
Copy-Item -Recurse "$Tmp/scripts" (Join-Path $InstallDir "scripts") -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
Push-Location $SvcDir; npm install --omit=dev 2>&1 | Select-Object -Last 1; Pop-Location
Ok "Registry API installed at $SvcDir"

# 4. First index
Info "Indexing your repo (first run)..."
trace-mcp index $Repo 2>&1 | Select-Object -Last 2

# 5. Scheduled task for refresh every 15 min + startup of API
Info "Registering refresh task (every 15 min) + API startup..."
$nodeExe = (Get-Command node).Source
$traceExe = (Get-Command trace-mcp).Source

# Refresh task: reindex every 15 min
$refreshAction = New-ScheduledTaskAction -Execute $traceExe -Argument "index `"$Repo`""
$refreshTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName "SypnoseRegistryRefresh" -Action $refreshAction -Trigger $refreshTrigger -Force | Out-Null
Ok "Refresh task registered (every 15 min)."

# API: start now in background + at logon
$startCmd = "cd `"$SvcDir`"; `$env:REGISTRY_PORT=$Port; `$env:REGISTRY_REPO=`"$Repo`"; node server.js"
Start-Process node -ArgumentList "server.js" -WorkingDirectory $SvcDir -WindowStyle Hidden -Environment @{REGISTRY_PORT=$Port; REGISTRY_REPO=$Repo} -ErrorAction SilentlyContinue
$logonAction = New-ScheduledTaskAction -Execute $nodeExe -Argument "server.js" -WorkingDirectory $SvcDir
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "SypnoseRegistryAPI" -Action $logonAction -Trigger $logonTrigger -Force | Out-Null
Ok "API set to start at logon."

# 6. Verify
Start-Sleep -Seconds 3
try {
  $r = Invoke-WebRequest -Uri "http://localhost:$Port/health" -TimeoutSec 6 -UseBasicParsing
  if ($r.StatusCode -eq 200) { Ok "Registry API live: http://localhost:$Port/health" } else { Warn "API HTTP $($r.StatusCode)" }
} catch { Warn "API not responding yet - check the hidden node process or run: cd $SvcDir; node server.js" }

Write-Host "`n=== Sypnose Registry installed ===" -ForegroundColor Green
Write-Host "Indexed: $Repo  |  API: http://localhost:$Port/codegraph/summary  |  Refresh: every 15 min (Task Scheduler: SypnoseRegistryRefresh)"
