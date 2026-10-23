<#
.SYNOPSIS
    Runs the backend and frontend test suites.

.DESCRIPTION
    Backend: go vet ./... and go test ./... -race
    Frontend: npm test (Vitest, run once)

.EXAMPLE
    .\scripts\test.ps1
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [string] $FrontendDir = '',
    [switch] $BackendOnly,
    [switch] $FrontendOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
if (-not $FrontendDir) { $FrontendDir = Join-Path $repoRoot 'frontend' }

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
$failed = $false

if (-not $FrontendOnly) {
    Write-Host '==> go vet ./...' -ForegroundColor Cyan
    Push-Location $backendDir
    try {
        & $go vet ./...
        if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "go vet failed ($LASTEXITCODE)" -ForegroundColor Red }
    }
    finally { Pop-Location }

    Write-Host '==> go test ./... -race' -ForegroundColor Cyan
    Push-Location $backendDir
    try {
        & $go test ./... -race
        if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "go test failed ($LASTEXITCODE)" -ForegroundColor Red }
    }
    finally { Pop-Location }
}

if (-not $BackendOnly) {
    Write-Host '==> npm test (frontend)' -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $FrontendDir 'package.json'))) {
        throw "No frontend/package.json found at $FrontendDir."
    }
    Push-Location $FrontendDir
    try {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { $failed = $true; Write-Host "npm test failed ($LASTEXITCODE)" -ForegroundColor Red }
    }
    finally { Pop-Location }
}

if ($failed) { throw 'One or more test suites failed.' }
Write-Host 'All tests passed.' -ForegroundColor Green
