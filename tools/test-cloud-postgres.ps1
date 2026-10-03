param(
    [Parameter(Mandatory)][string]$PostgresBin,
    [int]$Port = 19594
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$binaryRoot = (Resolve-Path -LiteralPath $PostgresBin).Path
foreach ($binary in 'initdb.exe', 'pg_ctl.exe', 'psql.exe', 'pg_dump.exe', 'pg_restore.exe') {
    if (-not (Test-Path -LiteralPath (Join-Path $binaryRoot $binary))) { throw "PostgreSQL test binary missing: $binary" }
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw 'Test port is occupied; no existing database will be reused.' }
$artifactRoot = Join-Path $repo 'artifacts/cloud-postgres'
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null
$testRoot = New-Item -ItemType Directory -Path (Join-Path $artifactRoot ([guid]::NewGuid().ToString('N')))
$cluster = Join-Path $testRoot.FullName 'cluster'
$originalConnection = $env:WISP_CLOUD_TEST_CONNECTION
$originalBinaries = $env:WISP_CLOUD_TEST_PG_BIN
$started = $false
function Invoke-PgTool([string]$Name, [string[]]$ToolArguments) {
    $log = Join-Path $testRoot.FullName ($Name + '-' + [guid]::NewGuid().ToString('N'))
    # pg_ctl's persistent child must not inherit this shell's pipe handles.
    $quoted = $ToolArguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
    $process = Start-Process -FilePath (Join-Path $binaryRoot $Name) -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput ($log + '.stdout') -RedirectStandardError ($log + '.stderr')
    # Start-Process -Wait waits for descendants too, including the persistent
    # postgres server. Wait for the short-lived utility process only.
    if (-not $process.WaitForExit(30000)) { throw "Owned PostgreSQL utility timed out: $Name" }
    if ($process.ExitCode -ne 0) { throw "Owned PostgreSQL test command failed: $Name. See ignored artifacts." }
}
try {
    Invoke-PgTool 'initdb.exe' @('-D', $cluster, '-U', 'wisp_cloud_test', '--encoding=UTF8', '--locale=C', '--auth=trust')
    $started = $true
    Invoke-PgTool 'pg_ctl.exe' @('-D', $cluster, '-l', (Join-Path $testRoot.FullName 'postgres.log'), '-o', "-h 127.0.0.1 -p $Port", '-w', 'start')
    Invoke-PgTool 'psql.exe' @('-h', '127.0.0.1', '-p', "$Port", '-U', 'wisp_cloud_test', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE wisp_cloud_test;')
    $env:WISP_CLOUD_TEST_CONNECTION = "Host=127.0.0.1;Port=$Port;Database=wisp_cloud_test;Username=wisp_cloud_test;Maximum Pool Size=10;Timeout=5;Command Timeout=15"
    $env:WISP_CLOUD_TEST_PG_BIN = $binaryRoot
    Push-Location $repo
    try {
        dotnet test Wisp.Cloud.slnx -c Release
        if ($LASTEXITCODE -ne 0) { throw 'Cloud tests failed.' }
    } finally { Pop-Location }
} finally {
    $env:WISP_CLOUD_TEST_CONNECTION = $originalConnection
    $env:WISP_CLOUD_TEST_PG_BIN = $originalBinaries
    if ($started) {
        # Only the freshly created owned cluster is stopped; no system service,
        # existing data directory or other PostgreSQL port is touched.
        Invoke-PgTool 'pg_ctl.exe' @('-D', $cluster, '-m', 'fast', '-w', 'stop')
    }
}
# Artifacts are deliberately retained in an ignored, isolated directory.
