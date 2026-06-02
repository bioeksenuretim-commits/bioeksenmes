param(
    [string]$ProjectId = "reaksiyontalep",
    [string]$BuildVersion = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$initPath = Join-Path $repoRoot "js/init-v4.js"
$indexPath = Join-Path $repoRoot "index.html"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $initPath)) {
    throw "APP_BUILD_VERSION guncellenemedi. Dosya yok: $initPath"
}

if (-not (Test-Path -LiteralPath $indexPath)) {
    throw "init-v4.js cache query guncellenemedi. Dosya yok: $indexPath"
}

$initContent = [System.IO.File]::ReadAllText($initPath, $utf8NoBom)
$match = [regex]::Match($initContent, "const\s+APP_BUILD_VERSION\s*=\s*['""]([^'""]+)['""]")

if (-not $match.Success) {
    throw "APP_BUILD_VERSION js/init-v4.js icinde bulunamadi."
}

$appBuildVersion = $BuildVersion.Trim()
if (-not $appBuildVersion) {
    $appBuildVersion = Get-Date -Format "yyyyMMdd-HHmmss"
}

$updatedInitContent = [regex]::Replace(
    $initContent,
    "const\s+APP_BUILD_VERSION\s*=\s*['""][^'""]+['""]",
    "const APP_BUILD_VERSION = '$appBuildVersion'",
    1
)
[System.IO.File]::WriteAllText($initPath, $updatedInitContent, $utf8NoBom)

$indexContent = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
$updatedIndexContent = [regex]::Replace(
    $indexContent,
    "(/js/init-v4\.js\?v=)[^'""]+",
    "`${1}$appBuildVersion"
)
$updatedIndexContent = [regex]::Replace(
    $updatedIndexContent,
    "(/js/app-main-v4\.js\?v=)[^'""]+",
    "`${1}$appBuildVersion"
)
[System.IO.File]::WriteAllText($indexPath, $updatedIndexContent, $utf8NoBom)

Write-Host "Deploy basliyor. Project: $ProjectId Build: $appBuildVersion"

function Invoke-FirebaseCli {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & firebase @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Firebase komutu basarisiz oldu: firebase $($Arguments -join ' ')"
    }
}

Invoke-FirebaseCli -Arguments @("deploy", "--only", "hosting", "--project", $ProjectId)

$buildVersionJsonPath = [System.IO.Path]::GetTempFileName()
try {
    ConvertTo-Json $appBuildVersion -Compress | Set-Content -LiteralPath $buildVersionJsonPath -Encoding ASCII
    Invoke-FirebaseCli -Arguments @("database:set", "/appMeta/buildVersion", $buildVersionJsonPath, "--force", "--project", $ProjectId)
}
finally {
    if (Test-Path -LiteralPath $buildVersionJsonPath) {
        Remove-Item -LiteralPath $buildVersionJsonPath -Force
    }
}

Write-Host "Deploy tamamlandi ve appMeta/buildVersion guncellendi: $appBuildVersion"
