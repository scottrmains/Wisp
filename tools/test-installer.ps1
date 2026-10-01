# Runs only on an ephemeral GitHub runner because installation creates shortcuts
# and uninstall registration for Wisp. Local builds do not install automatically.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run installer lifecycle verification on a GitHub Actions runner.' }
$installerPath = (Resolve-Path $Installer).Path
$testRoot = Join-Path $env:RUNNER_TEMP "wisp-installer-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $testRoot 'app'
$profileDir = Join-Path $testRoot 'profile'
New-Item -ItemType Directory -Force $profileDir | Out-Null
$marker = Join-Path $profileDir 'keep-on-uninstall.txt'
'existing user data' | Set-Content $marker

function Invoke-Setup([string]$Exe, [string[]]$Arguments) {
    $process = Start-Process $Exe -ArgumentList $Arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Setup failed with exit code $($process.ExitCode)." }
}

$env:WISP_DATA_DIR = $profileDir
$env:DOTNET_ENVIRONMENT = 'Production'
try {
    # Reinstall into the same path to exercise the upgrade flow as well.
    foreach ($pass in 1..2) {
        Invoke-Setup $installerPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installDir`"", "/LOG=`"$testRoot/install-$pass.log`"")
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $port = $listener.LocalEndpoint.Port
        $listener.Stop()
        $url = "http://127.0.0.1:$port"
        $appProcess = Start-Process (Join-Path $installDir 'Wisp.exe') `
            -ArgumentList @('--Wisp:LaunchPhotino=false', '--urls', $url) `
            -WorkingDirectory $testRoot -WindowStyle Hidden -PassThru
        try {
            $health = $null
            for ($attempt = 0; $attempt -lt 60; $attempt++) {
                if ($appProcess.HasExited) { throw "Installed Wisp exited with code $($appProcess.ExitCode)." }
                try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2 } catch { Start-Sleep -Seconds 1 }
                if ($health) { break }
            }
            if ($health.status -ne 'ok') { throw 'Installed Wisp did not become healthy.' }
            $entry = Invoke-WebRequest $url
            if ($entry.Headers['Cache-Control'] -notmatch 'no-store') { throw 'Installed entry HTML can be cached.' }
            $page = $entry.Content
            $installedHtml = [System.IO.File]::ReadAllText((Join-Path $installDir 'wwwroot/index.html'))
            if ($page -cne $installedHtml) { throw 'Installed app served a different client entry point.' }
            $launchUri = [uri]$health.uiLaunchUrl
            if ($launchUri.GetLeftPart([System.UriPartial]::Authority) -ne $url -or $launchUri.Query -notmatch 'wisp-ui=') {
                throw 'Installed desktop launch URL lacks the same-origin release cache key.'
            }
            $launchPage = Invoke-WebRequest $launchUri
            if ($launchPage.Content -cne $installedHtml -or $launchPage.Headers['Cache-Control'] -notmatch 'no-store') {
                throw 'Versioned launch did not serve the uncached installed UI.'
            }
            if ($page -notmatch 'src="([^"]+\.js)"') { throw 'Installed client entry point is missing.' }
            $asset = Invoke-WebRequest "$url$($Matches[1])"
            if ($asset.Headers['Content-Type'] -notmatch 'javascript') { throw 'Installed JavaScript asset was not served.' }
            if (!(Test-Path (Join-Path $profileDir 'wisp.db'))) { throw 'Fresh library database was not created.' }
            if ((Get-Content $marker) -ne 'existing user data') { throw 'Upgrade changed user data.' }
        }
        finally {
            if (!$appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force }
        }
    }
    # A fresh profile and reinstalling the same build cannot catch the user's
    # stale WebView HTML failure. Reproduce an older entry in a persistent
    # Chromium disk cache, then start the actual installed app at that origin.
    & node (Join-Path $PSScriptRoot 'test-ui-upgrade-cache.mjs') `
        --app (Join-Path $installDir 'Wisp.exe') --data-root (Join-Path $testRoot 'cache-upgrade')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application failed the warmed-cache upgrade regression.' }
    Invoke-Setup (Join-Path $installDir 'unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    if (Test-Path (Join-Path $installDir 'Wisp.exe')) { throw 'Uninstall left Wisp.exe behind.' }
    if (!(Test-Path $marker) -or !(Test-Path (Join-Path $profileDir 'wisp.db'))) { throw 'Uninstall removed user data.' }
    Write-Host 'Installer passed: fresh install, current SPA startup, upgrade, persistent old-UI cache recovery and data-preserving uninstall.'
}
catch {
    Get-ChildItem $testRoot -Filter '*.log' -Recurse | ForEach-Object {
        Write-Host "Log: $($_.FullName)"
        Get-Content $_.FullName -Tail 45
    }
    throw
}
finally {
    Remove-Item Env:WISP_DATA_DIR -ErrorAction SilentlyContinue
}
