<#
.SYNOPSIS
    Measures the latency of the Noto HTTP API on a generated notes tree.

.DESCRIPTION
    Creates a temporary notes directory with -Notes Markdown files, starts a
    real server (go run ./cmd/noto) on a free port with its own NOTO_DATA_DIR,
    reindexes the notes and then measures the latency of GET /api/tree,
    GET /api/search, GET /api/notes and PUT /api/notes.

    The script prints a table with the median and the p95 of every operation
    and removes the temporary directory when it is done. The server is always
    stopped, also when the script fails.

.EXAMPLE
    .\scripts\measure-perf.ps1

.EXAMPLE
    .\scripts\measure-perf.ps1 -Notes 5000 -Iterations 15
#>
[CmdletBinding()]
param(
    [string] $GoExe = '',
    [string] $BackendDir = '',
    [int] $Notes = 2000,
    [int] $Iterations = 7,
    [int] $Port = 0,
    [switch] $KeepData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $BackendDir) { $BackendDir = Join-Path $repoRoot 'backend' }
if (-not (Test-Path (Join-Path $BackendDir 'go.mod'))) {
    throw "No Go module found at $BackendDir."
}

function Resolve-Go {
    param([string] $Explicit)
    if ($Explicit) { return $Explicit }
    $local = Join-Path $repoRoot '.tools\goroot\go\bin\go.exe'
    if (Test-Path $local) { return $local }
    $cmd = Get-Command go -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'Go toolchain not found. Install Go 1.23+ or set -GoExe.'
}

function Get-FreePort {
    $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), 0
    $listener.Start()
    try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
    finally { $listener.Stop() }
}

function Get-Percentile {
    param([double[]] $Values, [double] $Percentile)
    if (-not $Values -or $Values.Count -eq 0) { return 0.0 }
    $sorted = @($Values | Sort-Object)
    $rank = [math]::Ceiling($Percentile / 100.0 * $sorted.Count) - 1
    if ($rank -lt 0) { $rank = 0 }
    if ($rank -ge $sorted.Count) { $rank = $sorted.Count - 1 }
    return [double]$sorted[$rank]
}

function Get-Median {
    param([double[]] $Values)
    if (-not $Values -or $Values.Count -eq 0) { return 0.0 }
    $sorted = @($Values | Sort-Object)
    $mid = [int][math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 1) { return [double]$sorted[$mid] }
    return ([double]$sorted[$mid - 1] + [double]$sorted[$mid]) / 2.0
}

$go = Resolve-Go -Explicit $GoExe
if ($Notes -le 0) { throw 'The number of notes must be positive.' }
if ($Iterations -le 0) { throw 'The number of iterations must be positive.' }

$tmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('noto-perf-' + [guid]::NewGuid().ToString('N'))
$notesDir = Join-Path $tmpRoot 'notes'
$dataDir = Join-Path $tmpRoot 'data'
$serverLog = Join-Path $tmpRoot 'server.log'
$serverProc = $null
$client = $null

try {
    New-Item -ItemType Directory -Path $notesDir -Force | Out-Null
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

    Write-Host "==> Generating $Notes notes in $notesDir" -ForegroundColor Cyan
    $body = "# Perf`n`nlorem ipsum dolor sit amet, consectetur adipiscing elit.`n"
    $folders = 20
    for ($i = 0; $i -lt $Notes; $i++) {
        $folder = Join-Path $notesDir ('folder-{0:d2}' -f ($i % $folders))
        if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
        Set-Content -Path (Join-Path $folder ('note-{0:d5}.md' -f $i)) -Value $body -Encoding UTF8 -NoNewline
    }

    if ($Port -le 0) { $Port = Get-FreePort }
    $baseUrl = "http://127.0.0.1:$Port"

    $env:NOTO_ADDR = "127.0.0.1:$Port"
    $env:NOTO_DATA_DIR = $dataDir
    $env:NOTO_NOTES_DIR = $notesDir
    $env:NOTO_TRASH_DIR = Join-Path $dataDir 'trash'
    $env:NOTO_ATTACHMENTS_DIR = Join-Path $dataDir 'attachments'
    $env:NOTO_DB_PATH = Join-Path $dataDir 'noto.db'
    $env:NOTO_LOG_LEVEL = 'warn'

    Write-Host "==> Starting the server on $baseUrl" -ForegroundColor Cyan
    $serverProc = Start-Process -FilePath $go -ArgumentList @('run', './cmd/noto') `
        -WorkingDirectory $BackendDir -PassThru -NoNewWindow `
        -RedirectStandardOutput $serverLog -RedirectStandardError "$serverLog.err"

    Add-Type -AssemblyName System.Net.Http
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromMinutes(5)

    $ready = $false
    for ($i = 0; $i -lt 120; $i++) {
        if ($serverProc.HasExited) {
            $err = ''
            if (Test-Path "$serverLog.err") { $err = Get-Content "$serverLog.err" -Raw }
            throw "The server exited with the code $($serverProc.ExitCode).`n$err"
        }
        try {
            $res = $client.GetAsync("$baseUrl/api/health").GetAwaiter().GetResult()
            if ($res.StatusCode -eq 'OK') { $ready = $true; break }
        }
        catch { }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'The server did not become ready in time.' }

    Write-Host '==> Reindexing the notes (fills the store and the search index)' -ForegroundColor Cyan
    $res = $client.PostAsync("$baseUrl/api/search/reindex", $null).GetAwaiter().GetResult()
    if ($res.StatusCode -ne 'OK') { throw "The reindex failed with the status $($res.StatusCode)." }

    function Invoke-Timed {
        param([string] $Method, [string] $Url, [string] $Content = $null)
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        if ($Method -eq 'PUT') {
            $msg = New-Object System.Net.Http.StringContent($Content, [System.Text.Encoding]::UTF8, 'application/json')
            $resp = $client.PutAsync($Url, $msg).GetAwaiter().GetResult()
        }
        else {
            $resp = $client.GetAsync($Url).GetAwaiter().GetResult()
        }
        $sw.Stop()
        if ($resp.StatusCode -ne 'OK') { throw "$Method $Url failed with the status $($resp.StatusCode)." }
        $null = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        return $sw.Elapsed.TotalMilliseconds
    }

    $operations = @(
        @{ Name = 'GET  /api/tree';            Method = 'GET';  Url = "$baseUrl/api/tree"; Content = '' },
        @{ Name = 'GET  /api/search?q=lorem';  Method = 'GET';  Url = "$baseUrl/api/search?q=lorem"; Content = '' },
        @{ Name = 'GET  /api/notes';           Method = 'GET';  Url = "$baseUrl/api/notes?path=folder-00/note-00000.md"; Content = '' },
        @{ Name = 'PUT  /api/notes';           Method = 'PUT';  Url = "$baseUrl/api/notes"; Content = '{"path":"folder-00/note-00000.md","content":"# Perf\n\nrewritten\n","revision":0}' }
    )

    $results = @()
    foreach ($op in $operations) {
        # A warm up request that is not measured.
        $null = Invoke-Timed -Method $op.Method -Url $op.Url -Content $op.Content
        $samples = @()
        for ($i = 0; $i -lt $Iterations; $i++) {
            $samples += Invoke-Timed -Method $op.Method -Url $op.Url -Content $op.Content
        }
        $results += [pscustomobject]@{
            Operation = $op.Name
            Median    = [math]::Round((Get-Median -Values $samples), 2)
            P95       = [math]::Round((Get-Percentile -Values $samples -Percentile 95), 2)
            Samples   = $samples
        }
    }

    Write-Host ''
    Write-Host "Notes: $Notes   Iterations: $Iterations   Platform: $([System.Environment]::OSVersion.VersionString)   Go: $($go)" -ForegroundColor Cyan
    Write-Host ''
    Write-Host ('{0,-28} {1,12} {2,12}' -f 'operation', 'median ms', 'p95 ms') -ForegroundColor Cyan
    Write-Host ('{0,-28} {1,12} {2,12}' -f ('-' * 28), ('-' * 12), ('-' * 12)) -ForegroundColor Cyan
    foreach ($r in $results) {
        Write-Host ('{0,-28} {1,12} {2,12}' -f $r.Operation, $r.Median, $r.P95)
    }
    Write-Host ''
}
finally {
    if ($client) { $client.Dispose() }
    if ($serverProc -and -not $serverProc.HasExited) {
        # go run spawns the server as a child process, so the whole tree is killed.
        try { & taskkill /PID $serverProc.Id /T /F 2>&1 | Out-Null } catch { }
        $null = $serverProc.WaitForExit(10000)
        if (-not $serverProc.HasExited) {
            try { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue } catch { }
        }
    }
    if ($KeepData) {
        Write-Host "The temporary directory was kept: $tmpRoot" -ForegroundColor Yellow
    }
    elseif (Test-Path $tmpRoot) {
        Remove-Item -Path $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
