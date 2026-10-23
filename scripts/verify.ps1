<#
.SYNOPSIS
    Runs the complete verification suite of Noto and prints a summary.

.DESCRIPTION
    Steps (each can be skipped):
      1. go build ./...                    (backend)
      2. go vet ./...                      (backend)
      3. go test ./... -race -count=1      (backend, needs a C compiler)
      4. go run ./cmd/smoke                (HTTP smoke suite against a real server)
      5. npm run check:boundaries          (frontend architecture boundaries)
      6. npm run typecheck                 (tsc --noEmit)
      7. npm test                          (Vitest)
      8. npm run build                     (production bundle -> backend/internal/web/dist)
      9. npm run measure                   (bundle size report)
     10. npx playwright test               (end to end; requires a Chromium build)

    The script never stops at the first failure: it runs every step and then
    reports which ones failed, so a single run gives the full picture.

.PARAMETER Skip
    Step names to skip: build, vet, test, smoke, boundaries, typecheck, unit, bundle, measure, e2e.

.PARAMETER E2E
    Include the end-to-end suite (off by default, it starts a real server).

.EXAMPLE
    .\scripts\verify.ps1

.EXAMPLE
    .\scripts\verify.ps1 -Skip e2e,smoke
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [string] $FrontendDir = '',
    [string[]] $Skip = @(),
    [switch] $E2E
)

$ErrorActionPreference = 'Continue'
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
$results = [ordered]@{}

function Invoke-Step {
    param(
        [string] $Name,
        [string] $Title,
        [scriptblock] $Action
    )
    Write-Host ''
    Write-Host "==> $Title" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Action
        $code = $LASTEXITCODE
        if ($null -eq $code) { $code = 0 }
    }
    catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        $code = 1
    }
    $sw.Stop()
    $ok = ($code -eq 0)
    if ($ok) {
        Write-Host ("    OK ({0:N1}s)" -f $sw.Elapsed.TotalSeconds) -ForegroundColor Green
    }
    else {
        Write-Host ("    FAILED (exit {0}, {1:N1}s)" -f $code, $sw.Elapsed.TotalSeconds) -ForegroundColor Red
    }
    $results[$Name] = [pscustomobject]@{ ok = $ok; code = $code; seconds = $sw.Elapsed.TotalSeconds }
}

function Should-Skip {
    param([string] $Name)
    return $Skip -contains $Name
}

if (-not (Should-Skip 'build')) {
    Invoke-Step 'build' 'go build ./... (backend)' {
        Push-Location $backendDir
        try { & $go build ./... } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'vet')) {
    Invoke-Step 'vet' 'go vet ./... (backend)' {
        Push-Location $backendDir
        try { & $go vet ./... } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'test')) {
    Invoke-Step 'test' 'go test ./... -race -count=1 (backend)' {
        $env:CGO_ENABLED = '1'
        $msys = 'C:\msys64\mingw64\bin'
        if (Test-Path $msys) { $env:PATH = "$msys;$env:PATH" }
        Push-Location $backendDir
        try { & $go test ./... -race -count=1 } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'smoke')) {
    Invoke-Step 'smoke' 'HTTP smoke suite (real server on a free port)' {
        Push-Location $backendDir
        try { & $go run ./cmd/smoke } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'boundaries')) {
    Invoke-Step 'boundaries' 'frontend architecture boundaries' {
        Push-Location $FrontendDir
        try { & node 'scripts/check-boundaries.mjs' } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'typecheck')) {
    Invoke-Step 'typecheck' 'tsc --noEmit (frontend)' {
        Push-Location $FrontendDir
        try { & npx.cmd tsc --noEmit } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'unit')) {
    Invoke-Step 'unit' 'npm test (Vitest, frontend)' {
        Push-Location $FrontendDir
        try { & npm.cmd test } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'bundle')) {
    Invoke-Step 'bundle' 'npm run build (production bundle)' {
        Push-Location $FrontendDir
        try { & npm.cmd run build } finally { Pop-Location }
    }
}

if (-not (Should-Skip 'measure')) {
    Invoke-Step 'measure' 'bundle size report' {
        Push-Location $FrontendDir
        try { & node 'scripts/measure-bundle.mjs' } finally { Pop-Location }
    }
}

if ($E2E -and -not (Should-Skip 'e2e')) {
    Invoke-Step 'e2e' 'npx playwright test (end to end)' {
        Push-Location $repoRoot
        try { & npx.cmd playwright test --reporter=list } finally { Pop-Location }
    }
}

Write-Host ''
Write-Host '== Verification summary ==' -ForegroundColor Cyan
$failedNames = @()
foreach ($entry in $results.GetEnumerator()) {
    $mark = if ($entry.Value.ok) { 'PASS' } else { 'FAIL' }
    $color = if ($entry.Value.ok) { 'Green' } else { 'Red' }
    Write-Host ("{0,-10} {1,-6} ({2:N1}s)" -f $entry.Key, $mark, $entry.Value.seconds) -ForegroundColor $color
    if (-not $entry.Value.ok) { $failedNames += $entry.Key }
}

if ($failedNames.Count -gt 0) {
    Write-Host ''
    Write-Host ("FAILED: {0}" -f ($failedNames -join ', ')) -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'All verification steps passed.' -ForegroundColor Green
exit 0
