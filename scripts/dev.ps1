<#
.SYNOPSIS
    Runs the Noto backend and the Vite dev server side by side.

.DESCRIPTION
    Starts the Go API server on http://127.0.0.1:8080 and the Vite dev server
    (default http://127.0.0.1:5173) in the same window. The Vite dev server
    proxies /api to the backend, so the UI works exactly like in production.

    Press Ctrl+C to stop both processes.

.EXAMPLE
    .\scripts\dev.ps1
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
Write-Host "Using Go: $go" -ForegroundColor DarkGray

$procs = @()

try {
    if (-not $FrontendOnly) {
        Write-Host 'Starting backend on http://127.0.0.1:8080 ...' -ForegroundColor Cyan
        $backend = Start-Process -FilePath $go -ArgumentList @('run', './cmd/noto') `
            -WorkingDirectory $backendDir -NoNewWindow -PassThru
        $procs += $backend
    }

    if (-not $BackendOnly) {
        if (-not (Test-Path (Join-Path $FrontendDir 'package.json'))) {
            throw "No frontend/package.json found at $FrontendDir. Run this script from the repository root."
        }
        Write-Host 'Starting Vite dev server on http://127.0.0.1:5173 ...' -ForegroundColor Cyan
        $npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue)
        if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
        if (-not $npm) { throw 'npm not found on PATH. Install Node.js 20+.' }
        $frontend = Start-Process -FilePath $npm.Source -ArgumentList @('run', 'dev') `
            -WorkingDirectory $FrontendDir -NoNewWindow -PassThru
        $procs += $frontend
    }

    Write-Host ''
    Write-Host 'Noto is running. Open http://127.0.0.1:5173 in a browser.' -ForegroundColor Green
    Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray

    while ($true) {
        Start-Sleep -Seconds 2
        $alive = @($procs | Where-Object { -not $_.HasExited })
        if ($alive.Count -eq 0) { break }
    }
}
finally {
    foreach ($p in $procs) {
        if ($p -and -not $p.HasExited) {
            Write-Host "Stopping process $($p.Id) ..." -ForegroundColor DarkGray
            try { $p.Kill() } catch { }
        }
    }
}
