# Fetch pristine, versioned payloads; never package locally edited sidecar configs.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dependencyRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/dependencies'
New-Item -ItemType Directory -Force $dependencyRoot | Out-Null

function Get-VerifiedArchive([string]$Name, [string]$Url, [string]$Sha256) {
    $archivePath = Join-Path $dependencyRoot $Name
    if (!(Test-Path $archivePath) -or (Get-FileHash $archivePath -Algorithm SHA256).Hash -ne $Sha256) {
        Invoke-WebRequest $Url -OutFile $archivePath
    }
    if ((Get-FileHash $archivePath -Algorithm SHA256).Hash -ne $Sha256) {
        throw "Checksum mismatch for $Name"
    }
    return $archivePath
}

$slskdArchive = Get-VerifiedArchive 'slskd-0.25.1-win-x64.zip' `
    'https://github.com/slskd/slskd/releases/download/0.25.1/slskd-0.25.1-win-x64.zip' `
    '5435531bd256a13c026180e30f3123a5d9f61e5653eca149cd93f1acfdbc2b99'
$ffmpegArchive = Get-VerifiedArchive 'ffmpeg-8.0.1-essentials_build.zip' `
    'https://github.com/GyanD/codexffmpeg/releases/download/8.0.1/ffmpeg-8.0.1-essentials_build.zip' `
    'e2aaeaa0fdbc397d4794828086424d4aaa2102cef1fb6874f6ffd29c0b88b673'

# Unique extraction paths prevent a previous build's files leaking into a release.
$extractRoot = Join-Path $dependencyRoot ([guid]::NewGuid().ToString('N'))
Expand-Archive $slskdArchive (Join-Path $extractRoot 'slskd')
Expand-Archive $ffmpegArchive (Join-Path $extractRoot 'ffmpeg')
$slskdExe = @(Get-ChildItem (Join-Path $extractRoot 'slskd') -Recurse -Filter slskd.exe)
$ffmpegExe = @(Get-ChildItem (Join-Path $extractRoot 'ffmpeg') -Recurse -Filter ffmpeg.exe)
if ($slskdExe.Count -ne 1 -or $ffmpegExe.Count -ne 1) { throw 'Unexpected dependency archive layout.' }

# Microsoft's signed Evergreen bootstrapper installs WebView2 only when needed.
$webviewInstaller = Join-Path $dependencyRoot 'MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webviewInstaller
$signature = Get-AuthenticodeSignature $webviewInstaller
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw 'WebView2 bootstrapper signature verification failed.'
}

[pscustomobject]@{
    SlskdRoot = $slskdExe[0].DirectoryName
    FfmpegBinary = $ffmpegExe[0].FullName
    FfmpegRoot = $ffmpegExe[0].Directory.Parent.FullName
    WebViewInstaller = $webviewInstaller
}
