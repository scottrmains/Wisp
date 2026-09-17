# Fetch pristine, versioned payloads; never package locally edited sidecar configs.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. (Join-Path $PSScriptRoot 'dependency-downloads.ps1')
$dependencyRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'artifacts/dependencies'
New-Item -ItemType Directory -Force $dependencyRoot | Out-Null

function Get-VerifiedArchive([string]$Name, [string]$Url, [string]$Sha256) {
    Get-WispVerifiedArchive -Name $Name -Urls @($Url) -Sha256 $Sha256 -CacheDirectory $dependencyRoot
}

$slskdArchive = Get-VerifiedArchive 'slskd-0.25.1-win-x64.zip' `
    'https://github.com/slskd/slskd/releases/download/0.25.1/slskd-0.25.1-win-x64.zip' `
    '5435531bd256a13c026180e30f3123a5d9f61e5653eca149cd93f1acfdbc2b99'
$ffmpegArchive = Get-WispFfmpegArchive -CacheDirectory $dependencyRoot

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
