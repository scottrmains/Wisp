# Fetches a static Windows x64 build of ffmpeg.exe and places it at
# tools/ffmpeg/ffmpeg.exe so the Wisp.Api publish target can bundle it
# alongside Wisp.exe. The binary is gitignored — every fresh checkout
# needs to run this once before `dotnet publish` produces a working
# Convert-to-MP3 build.
#
# Source: gyan.dev's "essentials" build (~100 MB, GPL).
# Includes libmp3lame, which is what we need for the FLAC → MP3 320
# transcode in Phase 23.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # speed up Invoke-WebRequest

$root = Split-Path -Parent $PSScriptRoot
$ffmpegDir = Join-Path $root 'tools\ffmpeg'
$ffmpegExe = Join-Path $ffmpegDir 'ffmpeg.exe'
$zipPath = Join-Path $ffmpegDir 'ffmpeg-essentials.zip'

if (Test-Path $ffmpegExe) {
    Write-Host "ffmpeg.exe already present at $ffmpegExe — skipping download."
    Write-Host "(Delete it first if you want to re-fetch.)"
    exit 0
}

if (-not (Test-Path $ffmpegDir)) {
    New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
}

$url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
Write-Host "Downloading FFmpeg essentials build from $url ..."
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $ffmpegDir -Force

# The zip nests the binary under ffmpeg-{version}-essentials_build/bin/ —
# flatten it so the bundling pipeline always finds the same path.
$nested = Get-ChildItem -Path $ffmpegDir -Recurse -Filter ffmpeg.exe | Select-Object -First 1
if ($null -eq $nested) {
    throw "Could not find ffmpeg.exe in the extracted archive."
}
Move-Item -Path $nested.FullName -Destination $ffmpegExe -Force

# Clean up the extracted folder + zip.
Get-ChildItem -Path $ffmpegDir -Directory | Remove-Item -Recurse -Force
Remove-Item -Path $zipPath -Force

$size = (Get-Item $ffmpegExe).Length / 1MB
Write-Host ("ffmpeg.exe placed at $ffmpegExe ({0:N1} MB)." -f $size)
