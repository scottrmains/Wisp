# Use the same pinned, verified FFmpeg essentials archive as the installer.
[CmdletBinding()]
param(
    [string]$DestinationPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/ffmpeg/ffmpeg.exe'),
    [string]$CacheDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/dependencies')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dependency-downloads.ps1')
$archive = Get-WispFfmpegArchive -CacheDirectory $CacheDirectory
$dependency = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ffmpeg-dependency.json') -Raw | ConvertFrom-Json
$destination = [IO.Path]::GetFullPath($DestinationPath)
New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
$candidate = "$destination.$([guid]::NewGuid().ToString('N')).exe"
try {
    # Extract only the expected binary. Never clear a directory or select a stale executable.
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $entries = @($zip.Entries | Where-Object { $_.FullName -match '(^|/)bin/ffmpeg\.exe$' })
        if ($entries.Count -ne 1) { throw 'Unexpected FFmpeg archive layout: expected exactly one bin/ffmpeg.exe.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $candidate)
    } finally { $zip.Dispose() }
    $version = & $candidate -version 2>&1
    if ($LASTEXITCODE -ne 0 -or $version[0] -notmatch ('^ffmpeg version ' + [regex]::Escape($dependency.version) + '[-\s]')) {
        throw 'The verified FFmpeg binary failed its version smoke test; existing binary retained.'
    }
    if (!(Test-Path -LiteralPath $destination) -or
        (Get-FileHash -LiteralPath $destination).Hash -ne (Get-FileHash -LiteralPath $candidate).Hash) {
        Move-Item -LiteralPath $candidate -Destination $destination -Force
    }
    Write-Host "Verified FFmpeg $($dependency.version) ready at $destination"
} finally {
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
}
