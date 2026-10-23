<#
.SYNOPSIS
    Runs the complete verification suite of Noto and prints a summary.

.DESCRIPTION
    Steps (each can be skipped):
      1. npm run check:boundaries          (frontend architecture boundaries)
      2. go build ./...                    (backend)
      3. go vet ./...                      (backend)
      4. go test ./... -race -count=1      (backend, needs a C compiler)
      5. go run ./cmd/smoke                (HTTP smoke suite against a real server)
      6. npm run typecheck                 (tsc --noEmit)
      7. npm test                          (Vitest)
      8. npm run build                     (production bundle -> backend/internal/web/dist)
      9. npm run measure                   (bundle size report)
     10. go test ./internal/notes -bench   (Go benchmarks, only with -Bench)
     11. npx playwright test               (end to end; requires a Chromium build)

    The script never stops at the first failure: it runs every step and then
    reports which ones failed, so a single run gives the full picture.

.PARAMETER Skip
    Step names to skip: boundaries, build, vet, test, smoke, typecheck, unit,
    bundle, measure, bench, e2e.

.PARAMETER E2E
    Include the end-to-end suite (off by default, it starts a real server).

.PARAMETER Bench
    Include the Go benchmarks of backend/internal/notes.

.PARAMETER ReportPath
    Write a markdown report of the run to this file. No report is written when
    the parameter is empty (the default). The report is written even when some
    steps failed.

.EXAMPLE
    .\scripts\verify.ps1

.EXAMPLE
    .\scripts\verify.ps1 -Skip e2e,smoke

.EXAMPLE
    .\scripts\verify.ps1 -Skip test,smoke -ReportPath .tools\verify-report.md
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [string] $FrontendDir = '',
    [string[]] $Skip = @(),
    [switch] $E2E,
    [switch] $Bench,
    [string] $ReportPath = ''
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
    $results[$Name] = [pscustomobject]@{ ok = $ok; code = $code; seconds = $sw.Elapsed.TotalSeconds; title = $Title }
}

function Should-Skip {
    param([string] $Name)
    return $Skip -contains $Name
}

function Get-ToolVersion {
    param([scriptblock] $Action)
    try {
        $out = & $Action 2>&1 | Select-Object -First 1
        if ($null -eq $out) { return 'unknown' }
        return ("{0}" -f $out).Trim()
    }
    catch {
        return 'not available'
    }
}

function Write-Report {
    param(
        $Results,
        [string[]] $SummaryLines,
        [string[]] $FailedNames
    )
    $full = $ReportPath
    if (-not [System.IO.Path]::IsPathRooted($full)) {
        $full = Join-Path (Get-Location).Path $full
    }
    $dir = Split-Path -Parent $full
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $lines = @()
    $lines += '# Verification report'
    $lines += ''
    $lines += ("* generated: {0}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))
    $lines += ("* repository: {0}" -f $repoRoot)
    $lines += ("* result: {0}" -f $(if ($FailedNames.Count -gt 0) { 'FAIL' } else { 'PASS' }))
    $lines += ''
    $lines += '## Tool versions'
    $lines += ''
    $lines += '| tool | version |'
    $lines += '| --- | --- |'
    $lines += ("| go | {0} |" -f (Get-ToolVersion -Action { & $go version }))
    $lines += ("| node | {0} |" -f (Get-ToolVersion -Action { & node --version }))
    $lines += ("| npm | {0} |" -f (Get-ToolVersion -Action { & npm.cmd --version }))
    $lines += ''
    $lines += '## Steps'
    $lines += ''
    $lines += '| step | description | status | duration |'
    $lines += '| --- | --- | --- | --- |'
    foreach ($entry in $Results.GetEnumerator()) {
        $mark = if ($entry.Value.ok) { 'PASS' } else { 'FAIL' }
        $lines += ("| {0} | {1} | {2} | {3:N1}s |" -f $entry.Key, $entry.Value.title, $mark, $entry.Value.seconds)
    }
    $lines += ''
    $lines += '## Summary'
    $lines += ''
    $lines += '```'
    $lines += $SummaryLines
    $lines += '```'
    if ($FailedNames.Count -gt 0) {
        $lines += ''
        $lines += ("FAILED steps: {0}" -f ($FailedNames -join ', '))
    }
    Set-Content -Path $full -Value $lines -Encoding UTF8
    Write-Host ''
    Write-Host ("Report written to {0}" -f $full) -ForegroundColor Cyan
}

if (-not (Should-Skip 'boundaries')) {
    Invoke-Step 'boundaries' 'frontend architecture boundaries' {
        Push-Location $FrontendDir
        try { & node 'scripts/check-boundaries.mjs' } finally { Pop-Location }
    }
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

if ($Bench -and -not (Should-Skip 'bench')) {
    # The -run filter is not used on purpose: with the Go 1.27 toolchain
    # "-run=NONE" also suppresses the benchmarks, so no benchmark would run.
    Invoke-Step 'bench' 'go test ./internal/notes -bench=. -benchmem -count=1' {
        Push-Location $backendDir
        try { & $go test ./internal/notes -bench=. -benchmem -count=1 } finally { Pop-Location }
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
$summaryLines = @()
foreach ($entry in $results.GetEnumerator()) {
    $mark = if ($entry.Value.ok) { 'PASS' } else { 'FAIL' }
    $color = if ($entry.Value.ok) { 'Green' } else { 'Red' }
    $line = ("{0,-10} {1,-6} ({2:N1}s)" -f $entry.Key, $mark, $entry.Value.seconds)
    Write-Host $line -ForegroundColor $color
    $summaryLines += $line
    if (-not $entry.Value.ok) { $failedNames += $entry.Key }
}

if ($ReportPath) {
    Write-Report -Results $results -SummaryLines $summaryLines -FailedNames $failedNames
}

if ($failedNames.Count -gt 0) {
    Write-Host ''
    Write-Host ("FAILED: {0}" -f ($failedNames -join ', ')) -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host 'All verification steps passed.' -ForegroundColor Green
exit 0
