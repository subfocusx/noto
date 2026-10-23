<#
.SYNOPSIS
    Builds and runs the Noto backend API smoke test.

.DESCRIPTION
    Thin wrapper around `go run ./cmd/smoke`:
      1. builds the server binary and starts it against a throwaway data
         directory,
      2. exercises every endpoint of docs/CONTRACT.md,
      3. prints a PASS/FAIL line per check and a final summary.

    The script exits with 1 when at least one check failed.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\scripts\smoke.ps1
#>
[CmdletBinding()]
param(
    [string] $Go = 'E:\Code\Software\noto\.tools\goroot\go\bin\go.exe'
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repoRoot 'backend'

if (-not (Test-Path $Go)) {
    $found = Get-Command go -ErrorAction SilentlyContinue
    if (-not $found) {
        Write-Error "the Go toolchain was not found at '$Go' and 'go' is not on PATH"
    }
    $Go = $found.Source
}

Push-Location $backend
try {
    Write-Host "== noto smoke test =="
    Write-Host "   go:    $Go"
    Write-Host "   root:  $backend"
    Write-Host ''

    & $Go run ./cmd/smoke
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($code -ne 0) {
    Write-Host ''
    Write-Host "SMOKE TEST FAILED (exit code $code)" -ForegroundColor Red
} else {
    Write-Host ''
    Write-Host "SMOKE TEST PASSED" -ForegroundColor Green
}

exit $code
