# Shared checksum-verified archive acquisition. No downloads on import.
function Get-WispVerifiedArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._-]*\.zip$')][string]$Name,
        [Parameter(Mandatory)][string[]]$Urls,
        [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256,
        [Parameter(Mandatory)][string]$CacheDirectory,
        [ValidateRange(1, 5)][int]$Attempts = 3,
        [ValidateRange(0, 10)][int]$RetryDelaySeconds = 2,
        [ValidateRange(1, 300)][int]$TimeoutSeconds = 120
    )
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    if ($Urls.Count -eq 0) { throw 'At least one dependency URL is required.' }
    foreach ($url in $Urls) {
        if (([uri]$url).Scheme -ne 'https') { throw 'Dependency downloads require HTTPS.' }
    }
    $cacheRoot = [IO.Path]::GetFullPath($CacheDirectory)
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
    $archive = Join-Path $cacheRoot $Name
    if ((Test-Path -LiteralPath $archive -PathType Leaf) -and
        (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -eq $Sha256) {
        Write-Host "Using verified cached dependency: $Name"
        return $archive
    }
    $lastProblem = ''
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        foreach ($url in $Urls) {
            $partial = Join-Path $cacheRoot "$Name.$([guid]::NewGuid().ToString('N')).partial"
            try {
                Write-Host "Downloading $Name from $(([uri]$url).Host) (attempt $attempt/$Attempts)..."
                Invoke-WebRequest -Uri $url -OutFile $partial -TimeoutSec $TimeoutSeconds `
                    -Headers @{ Accept = 'application/octet-stream'; 'User-Agent' = 'Wisp-dependency-fetch' }
                if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $Sha256) {
                    throw "SHA-256 mismatch for $Name; refusing the download."
                }
                Move-Item -LiteralPath $partial -Destination $archive -Force
                return $archive
            } catch {
                $lastProblem = $_.Exception.Message
                if ($lastProblem.Length -gt 250) { $lastProblem = $lastProblem.Substring(0, 250) }
                Write-Warning "Dependency download failed: $lastProblem"
            } finally {
                if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
            }
        }
        if ($attempt -lt $Attempts -and $RetryDelaySeconds -gt 0) {
            Start-Sleep -Seconds ([Math]::Min(10, $RetryDelaySeconds * $attempt))
        }
    }
    throw "Unable to obtain verified $Name after $Attempts attempt(s) across $($Urls.Count) endpoint(s). No unverified download was installed. Retry when the host is available. Last error: $lastProblem"
}

function Get-WispFfmpegArchive {
    param([Parameter(Mandatory)][string]$CacheDirectory)
    $dependency = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ffmpeg-dependency.json') -Raw | ConvertFrom-Json
    Get-WispVerifiedArchive -Name $dependency.archive -Urls $dependency.urls -Sha256 $dependency.sha256 -CacheDirectory $CacheDirectory
}
