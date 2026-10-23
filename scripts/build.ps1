<#
.SYNOPSIS
    Builds the Noto frontend and then the Go backend binary.

.DESCRIPTION
    1. npm run build in frontend/ (production Vite build).
    2. Copy frontend/dist into backend/internal/web/dist so the Go binary can
       embed the SPA (see docs/CONTRACT.md section 3).
    3. go build -o noto(.exe) ./cmd/noto in backend/.

.EXAMPLE
    .\scripts\build.ps1
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [string] $FrontendDir = '',
    [string] $OutputDir = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
if (-not $FrontendDir) { $FrontendDir = Join-Path $repoRoot 'frontend' }
if (-not $OutputDir) { $OutputDir = Join-Path $repoRoot 'backend' }

function Resolve-Go {
    param([string] $Explicit)
    if ($Explicit) { return $Explicit }
    $local = Join-Path $repoRoot '.tools\goroot\go\bin\go.exe'
    if (Test-Path $local) { return $local }
    $cmd = Get-Command go -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Go toolchain not found. Install Go 1.23+ or set -GoExe.'
}

$go = Resolve-Go -Explicit $GoExe
$isWindows = ($IsWindows -or $env:OS -eq 'Windows_NT')
$binaryName = if ($isWindows) { 'noto.exe' } else { 'noto' }

Write-Host '==> Building frontend' -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $FrontendDir 'package.json'))) {
    throw "No frontend/package.json found at $FrontendDir."
}
Push-Location $FrontendDir
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

Write-Host '==> Copying frontend/dist into backend/internal/web/dist' -ForegroundColor Cyan
$src = Join-Path $FrontendDir 'dist'
$dst = Join-Path $backendDir 'internal\web\dist'
if (-not (Test-Path $src)) { throw "Frontend build output $src not found." }
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force

Write-Host '==> Building backend binary' -ForegroundColor Cyan
$outFile = Join-Path $OutputDir $binaryName
Push-Location $backendDir
try {
    & $go build -trimpath -o $outFile ./cmd/noto
    if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

Write-Host "Built $outFile" -ForegroundColor Green
Write-Host "Run it with: $outFile" -ForegroundColor DarkGray
