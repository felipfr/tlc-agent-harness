# Install runtime at %USERPROFILE%\.tlc\harness (Windows PowerShell)
$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:TLC_REPO_URL) { $env:TLC_REPO_URL } else { "https://github.com/felipfr/tlc-agent-harness.git" }
$Dest = if ($env:TLC_HOME) { $env:TLC_HOME } else { Join-Path $env:USERPROFILE ".tlc\harness" }
$BinDir = if ($env:TLC_BIN_DIR) { $env:TLC_BIN_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "install: missing dependency: $Name"
  }
}

Require-Command git
Require-Command node

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 24) {
  throw "install: Node.js 24+ required (found $(node -v)). https://nodejs.org/"
}

$scriptRoot = $PSScriptRoot
if ($scriptRoot -and (Test-Path (Join-Path $scriptRoot "bin\tlc-exec.mjs")) -and ($scriptRoot -ne $Dest)) {
  Write-Host "install: linking $Dest → $scriptRoot"
  $parentDir = Split-Path $Dest -Parent
  New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  if (Test-Path $Dest) {
    cmd /c "rmdir `"$Dest`"" 2>$null
    if (Test-Path $Dest) { Remove-Item -Force -Recurse $Dest }
  }
  cmd /c "mklink /J `"$Dest`" `"$scriptRoot`"" | Out-Null
} else {
  $parentDir = Split-Path $Dest -Parent
  New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  if (Test-Path (Join-Path $Dest ".git")) {
    git -C $Dest pull --ff-only
  } elseif (Test-Path $Dest) {
    throw "install: $Dest exists and is not a git checkout — move it aside and re-run."
  } else {
    git clone $RepoUrl $Dest
  }
}

$config = Join-Path $Dest "config.json"
$example = Join-Path $Dest "config.example.json"
if (-not (Test-Path $config) -and (Test-Path $example)) {
  Copy-Item $example $config
}

Copy-Item -Force (Join-Path $Dest "bin\tlc.cmd") (Join-Path $BinDir "tlc.cmd")

$skillsSrc = Join-Path $Dest "skills\harness-init"
$skillsDest = Join-Path $env:USERPROFILE ".tlc\skills\harness-init"
if (-not (Test-Path $skillsSrc)) {
  throw "install: missing $skillsSrc"
}
$skillsParent = Split-Path $skillsDest -Parent
New-Item -ItemType Directory -Force -Path $skillsParent | Out-Null
if (Test-Path $skillsDest) {
  cmd /c "rmdir `"$skillsDest`"" 2>$null
  if (Test-Path $skillsDest) { Remove-Item -Force -Recurse $skillsDest }
}
cmd /c "mklink /J `"$skillsDest`" `"$skillsSrc`"" | Out-Null

$env:TLC_HOME = $Dest
try {
  node (Join-Path $Dest "bin\write-user-hooks.mjs")
} catch {
  Write-Host "install: hooks not written automatically. Merge manually or run: node `"$Dest\bin\write-user-hooks.mjs`" --force"
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
  $env:Path = "$BinDir;$env:Path"
  Write-Host "install: added $BinDir to user PATH (new shells pick this up)."
}

Write-Host "install: ok → $Dest"
Write-Host "install: skill → $skillsDest"
try { & tlc harness doctor } catch { & (Join-Path $BinDir "tlc.cmd") harness doctor }
