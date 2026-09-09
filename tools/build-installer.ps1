[CmdletBinding()]
param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '0.1.0',
    [string]$IsccPath
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
if (!$IsccPath) {
    $compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($compiler) { $IsccPath = $compiler.Source }
    else { $IsccPath = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe' }
}
if (!(Test-Path $IsccPath)) { throw 'Install Inno Setup 6, or supply -IsccPath to its ISCC.exe.' }

Push-Location $repoRoot
try {
    $dependencies = & "$PSScriptRoot/get-packaging-dependencies.ps1"
    $output = Join-Path $repoRoot "artifacts/builds/$Version-$([guid]::NewGuid().ToString('N'))"
    $installerOutput = Join-Path $repoRoot 'artifacts/installers'
    & npm ci --prefix src/Wisp.Client --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Client dependency installation failed.' }
    & dotnet publish src/Wisp.Api -c Release -r win-x64 --self-contained true -o $output `
        "-p:Version=$Version" "-p:SlskdRoot=$($dependencies.SlskdRoot)/" `
        "-p:FfmpegBinary=$($dependencies.FfmpegBinary)"
    if ($LASTEXITCODE -ne 0) { throw 'Application publish failed.' }

    foreach ($file in @('Wisp.exe', 'Wisp.dll', 'coreclr.dll', 'wwwroot/index.html', 'slskd/slskd.exe', 'ffmpeg.exe')) {
        if (!(Test-Path (Join-Path $output $file))) { throw "Incomplete publish: missing $file" }
    }
    if (!(Get-ChildItem (Join-Path $output 'wwwroot/assets') -Filter '*.js')) { throw 'Published client assets are missing.' }

    $noticeDir = Join-Path $output 'third-party/ffmpeg'
    New-Item -ItemType Directory -Force $noticeDir | Out-Null
    Copy-Item (Join-Path $dependencies.FfmpegRoot 'LICENSE') $noticeDir
    Copy-Item (Join-Path $dependencies.FfmpegRoot 'README.txt') $noticeDir
    Copy-Item (Join-Path $repoRoot 'installer/THIRD-PARTY.md') (Join-Path $output 'third-party')
    & $IsccPath "/DAppVersion=$Version" "/DPublishDir=$output" "/DInstallerOutput=$installerOutput" `
        "/DWebViewInstaller=$($dependencies.WebViewInstaller)" (Join-Path $repoRoot 'installer/Wisp.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
    $installer = Join-Path $installerOutput "Wisp-Setup-$Version-win-x64.exe"
    $hash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $(Split-Path $installer -Leaf)" | Set-Content "$installer.sha256" -Encoding ascii
    Write-Host "Installer ready: $installer"
}
finally { Pop-Location }
