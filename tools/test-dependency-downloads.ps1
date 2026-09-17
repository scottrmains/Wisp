# Offline regression tests, including the 503 reported in the production pipeline.
# No Pester/module installation or external requests required.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'dependency-downloads.ps1')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('wisp-download-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$script:payload = [byte[]](1, 2, 3, 4)
$sha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($script:payload))
$script:requests = @()
$script:responses = @()
function Invoke-WebRequest {
    param($Uri, $OutFile, $TimeoutSec, $Headers)
    $script:requests += $Uri
    if ($TimeoutSec -le 0 -or $Headers.Accept -ne 'application/octet-stream') { throw 'Missing timeout/asset headers' }
    $index = $script:requests.Count - 1
    $response = $script:responses[$index]
    if ($response -eq '503') {
        [IO.File]::WriteAllBytes($OutFile, [byte[]](0, 0)) # interrupted transfer
        throw '503 Service Unavailable'
    }
    if ($response -eq 'corrupt') { [IO.File]::WriteAllBytes($OutFile, [byte[]](9)) }
    elseif ($response -eq 'ok') { [IO.File]::WriteAllBytes($OutFile, $script:payload) }
    else { throw 'Unexpected network call in offline test' }
}
function Assert([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Run-Case([string]$Name, [string[]]$Responses, [scriptblock]$Body) {
    $script:requests = @(); $script:responses = $Responses
    $directory = Join-Path $testRoot $Name
    New-Item -ItemType Directory -Path $directory | Out-Null
    & $Body $directory
    Assert (@(Get-ChildItem -LiteralPath $directory -Filter '*.partial').Count -eq 0) "$Name left a partial download"
    Write-Host "PASS: $Name"
}
function Fetch([string]$Directory, [string[]]$Urls = @('https://primary.test/file.zip', 'https://fallback.test/file.zip')) {
    Get-WispVerifiedArchive -Name 'fixture.zip' -Urls $Urls -Sha256 $sha -CacheDirectory $Directory -Attempts 2 -RetryDelaySeconds 0
}
try {
    Run-Case '503-fallback' @('503', 'ok') {
        param($directory)
        $file = Fetch $directory
        Assert ($script:requests.Count -eq 2) 'Fallback was not attempted'
        Assert ((Get-FileHash -LiteralPath $file).Hash -eq $sha) 'Invalid fallback result'
    }
    Run-Case 'transient-retry' @('503', 'ok') {
        param($directory)
        $null = Fetch $directory @('https://primary.test/file.zip')
        Assert ($script:requests.Count -eq 2) 'Transient failure was not retried'
    }
    Run-Case 'checksum-fallback' @('corrupt', 'ok') {
        param($directory)
        $file = Fetch $directory
        Assert ((Get-FileHash -LiteralPath $file).Hash -eq $sha) 'Corrupt bytes were accepted'
    }
    Run-Case 'cache-hit-no-network' @() {
        param($directory)
        [IO.File]::WriteAllBytes((Join-Path $directory 'fixture.zip'), $script:payload)
        $null = Fetch $directory
        Assert ($script:requests.Count -eq 0) 'Valid cache triggered network request'
    }
    Run-Case 'corrupt-cache-replaced' @('ok') {
        param($directory)
        [IO.File]::WriteAllBytes((Join-Path $directory 'fixture.zip'), [byte[]](0))
        $file = Fetch $directory
        Assert ((Get-FileHash -LiteralPath $file).Hash -eq $sha) 'Corrupt cache was trusted'
    }
    Run-Case 'all-hosts-down' @('503', '503', '503', '503') {
        param($directory)
        $failure = $null
        try { $null = Fetch $directory } catch { $failure = $_.Exception.Message }
        Assert ($failure -like '*Unable to obtain verified*') 'Total outage did not fail clearly'
        Assert ($script:requests.Count -eq 4) 'Retry count was not bounded'
        Assert (!(Test-Path -LiteralPath (Join-Path $directory 'fixture.zip'))) 'Partial result was cached'
    }
    Run-Case 'all-downloads-corrupt' @('corrupt', 'corrupt', 'corrupt', 'corrupt') {
        param($directory)
        $failure = $null
        try { $null = Fetch $directory } catch { $failure = $_.Exception.Message }
        Assert ($failure -like '*SHA-256 mismatch*') 'Checksum failure was not fatal'
        Assert (!(Test-Path -LiteralPath (Join-Path $directory 'fixture.zip'))) 'Unverified result was cached'
    }
    Run-Case 'https-required' @() {
        param($directory)
        $failure = $null
        try { $null = Fetch $directory @('http://primary.test/file.zip') } catch { $failure = $_.Exception.Message }
        Assert ($failure -like '*HTTPS*') 'Insecure URL accepted'
        Assert ($script:requests.Count -eq 0) 'Insecure network request attempted'
    }
    Write-Host 'All 8 dependency-download tests passed.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (!$resolved.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path $resolved -Leaf) -notlike 'wisp-download-tests-*') { throw 'Unsafe test cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
