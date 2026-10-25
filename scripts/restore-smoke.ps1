<#
.SYNOPSIS
    Checks that a backup can be restored and that the restored storage works.

.DESCRIPTION
    The script runs a full round trip in a temporary directory:

      1. build the backend (`go build ./...`);
      2. seed a throwaway data directory with one note;
      3. `go run ./cmd/backup -data <source> -out <archive>`;
      4. `go run ./cmd/restore -in <archive> -data <target> -force`;
      5. check that the note and the database are really there;
      6. `go run ./cmd/smoke` — the HTTP smoke suite against a real server.

    Every step must exit with 0, otherwise the script exits with 1.

    The script is idempotent: it always works in a new temporary directory and
    removes it at the end. It never touches the data of the user: only
    [System.IO.Path]::GetTempPath() is used.

.PARAMETER GoExe
    The Go toolchain to use. By default $env:GO, then the vendored toolchain
    of this machine (.tools\goroot\go\bin\go.exe), then `go` from PATH.

.PARAMETER KeepTemp
    Do not delete the temporary directory at the end (for debugging).

.EXAMPLE
    .\scripts\restore-smoke.ps1

.EXAMPLE
    $env:GO = 'C:\Program Files\Go\bin\go.exe'
    .\scripts\restore-smoke.ps1
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [switch] $KeepTemp
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'

function Resolve-Go {
    param([string] $Explicit)
    if ($Explicit) { return $Explicit }
    if ($env:GO -and (Test-Path $env:GO)) { return $env:GO }
    $local = Join-Path $repoRoot '.tools\goroot\go\bin\go.exe'
    if (Test-Path $local) { return $local }
    $cmd = Get-Command go -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Go toolchain not found. Install Go 1.23+, set $env:GO, or pass -GoExe.'
}

function Invoke-Step {
    param(
        [string] $Title,
        [string] $WorkDir,
        [string[]] $Arguments
    )
    Write-Host ''
    Write-Host "==> $Title" -ForegroundColor Cyan
    Push-Location $WorkDir
    try {
        & $script:go @Arguments
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    if ($null -eq $code) { $code = 0 }
    if ($code -ne 0) {
        throw "$Title failed with exit code $code"
    }
}

$script:go = Resolve-Go -Explicit $GoExe
Write-Host "go: $script:go" -ForegroundColor DarkGray

# The frontend is embedded into the binary (backend/internal/web/dist) and the
# directory is not part of the repository. Without it `go build` cannot
# compile, so a placeholder is created when the frontend was not built.
$webDist = Join-Path $backendDir 'internal\web\dist'
if (-not (Test-Path (Join-Path $webDist 'index.html'))) {
    Write-Host 'the frontend is not built: creating a placeholder in internal\web\dist' -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path $webDist | Out-Null
    Set-Content -Path (Join-Path $webDist 'index.html') -Value '<!doctype html><title>Noto (placeholder)</title>' -Encoding UTF8
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("noto-restore-smoke-" + [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
$sourceDir = Join-Path $tempRoot 'source-data'
$targetDir = Join-Path $tempRoot 'restored-data'
$archive = Join-Path $tempRoot 'backup.zip'

$noteRelative = Join-Path 'notes' 'restore-smoke.md'
$noteBody = "# Restore smoke`r`n`r`nThe round trip of the backup must survive.`r`n"

try {
    # 1. Build --------------------------------------------------------------
    Invoke-Step 'go build ./... (backend)' $backendDir @('build', './...')

    # 2. Seed ---------------------------------------------------------------
    Write-Host ''
    Write-Host '==> seeding the throwaway data directory' -ForegroundColor Cyan
    foreach ($dir in @('notes', 'attachments', 'trash')) {
        New-Item -ItemType Directory -Force -Path (Join-Path $sourceDir $dir) | Out-Null
    }
    $notePath = Join-Path $sourceDir $noteRelative
    [System.IO.File]::WriteAllText($notePath, $noteBody, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "    the note: $notePath"

    # The database is created by the server: the real server is started once
    # against the throwaway directory, so that the archive holds a real
    # database (with the schema and the metadata), not only the notes.
    Write-Host '    starting the server once to create the database' -ForegroundColor DarkGray
    $serverBin = Join-Path $tempRoot 'noto.exe'
    if (-not (Test-Path $serverBin)) {
        Push-Location $backendDir
        try {
            & $script:go build -o $serverBin ./cmd/noto
            if ($LASTEXITCODE -ne 0) { throw "the build of the server failed with exit code $LASTEXITCODE" }
        }
        finally {
            Pop-Location
        }
    }
    $port = 18000 + (Get-Random -Maximum 2000)
    $env:NOTO_DATA_DIR = $sourceDir
    $env:NOTO_ADDR = "127.0.0.1:$port"
    $server = Start-Process -FilePath $serverBin -PassThru -WindowStyle Hidden
    try {
        $ready = $false
        for ($i = 0; $i -lt 50; $i++) {
            Start-Sleep -Milliseconds 200
            try {
                $health = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
                if ($health.StatusCode -eq 200) { $ready = $true; break }
            }
            catch {
                # the server is not ready yet
            }
        }
        if (-not $ready) { throw 'the server did not become ready' }
        Write-Host '    the server is ready'
    }
    finally {
        if ($server -and -not $server.HasExited) {
            Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item Env:NOTO_DATA_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:NOTO_ADDR -ErrorAction SilentlyContinue
    }
    $sourceDb = Join-Path $sourceDir 'noto.db'
    if (-not (Test-Path $sourceDb)) {
        throw "the database was not created: $sourceDb"
    }

    # 3. Backup -------------------------------------------------------------
    Invoke-Step 'go run ./cmd/backup' $backendDir @('run', './cmd/backup', '-data', $sourceDir, '-out', $archive)
    if (-not (Test-Path $archive)) {
        throw "the backup archive was not created: $archive"
    }
    Write-Host ("    the archive: {0} ({1} bytes)" -f $archive, (Get-Item $archive).Length)

    # 4. Restore ------------------------------------------------------------
    Invoke-Step 'go run ./cmd/restore' $backendDir @('run', './cmd/restore', '-in', $archive, '-data', $targetDir, '-force')

    # 5. Verify the result --------------------------------------------------
    Write-Host ''
    Write-Host '==> checking the restored data directory' -ForegroundColor Cyan
    $restoredNote = Join-Path $targetDir $noteRelative
    if (-not (Test-Path $restoredNote)) {
        throw "the note was not restored: $restoredNote"
    }
    $restoredBody = [System.IO.File]::ReadAllText($restoredNote)
    if ($restoredBody -ne $noteBody) {
        throw 'the restored note differs from the original one'
    }
    $restoredDb = Join-Path $targetDir 'noto.db'
    if (-not (Test-Path $restoredDb)) {
        throw "the database was not restored: $restoredDb"
    }
    Write-Host '    the note and the database are in place'

    # 6. The HTTP smoke suite against a real server ------------------------
    Invoke-Step 'go run ./cmd/smoke' $backendDir @('run', './cmd/smoke')

    Write-Host ''
    Write-Host 'restore-smoke: OK (backup -> restore -> smoke, all green)' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host ''
    Write-Host ("restore-smoke: FAILED - {0}" -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
finally {
    if ($KeepTemp) {
        Write-Host ("the temporary directory was kept: {0}" -f $tempRoot) -ForegroundColor Yellow
    }
    elseif (Test-Path $tempRoot) {
        Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
    }
}
