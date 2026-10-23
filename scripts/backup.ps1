<#
.SYNOPSIS
    Creates a backup archive of the Noto data directory.

.DESCRIPTION
    Runs the backup command from backend/cmd/backup (see docs/CONTRACT.md).
    The tool packs the data directory — notes, attachments, trash and the
    SQLite database — into a single zip archive.

    Run `go run ./cmd/backup -h` inside backend/ to see the exact flags of the
    current implementation. Any extra arguments given with -BackupArgs are
    forwarded verbatim.

.EXAMPLE
    .\scripts\backup.ps1
    .\scripts\backup.ps1 -BackupArgs @('-out', 'D:\backups\noto.zip')
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [string] $BackupArgs = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'

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

$cmdArgs = @('run', './cmd/backup')
if ($BackupArgs) {
    $cmdArgs += ($BackupArgs -split '\s+' | Where-Object { $_ -ne '' })
}

Write-Host "Running: $go $($cmdArgs -join ' ')" -ForegroundColor Cyan

Push-Location $backendDir
try {
    & $go @cmdArgs
    if ($LASTEXITCODE -ne 0) { throw "Backup failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }

Write-Host 'Backup finished.' -ForegroundColor Green
Write-Host "The archive location is reported by the backup tool itself." -ForegroundColor DarkGray
