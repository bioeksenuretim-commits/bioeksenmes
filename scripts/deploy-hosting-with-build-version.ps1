param(
    [string]$ProjectId = "reaksiyontalep"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$initPath = Join-Path $repoRoot "js/init-v4.js"

if (-not (Test-Path -LiteralPath $initPath)) {
    throw "APP_BUILD_VERSION okunamadi. Dosya yok: $initPath"
}

$initContent = Get-Content -LiteralPath $initPath -Raw
$match = [regex]::Match($initContent, "const\s+APP_BUILD_VERSION\s*=\s*['""]([^'""]+)['""]")

if (-not $match.Success) {
    throw "APP_BUILD_VERSION js/init-v4.js icinde bulunamadi."
}

$appBuildVersion = $match.Groups[1].Value.Trim()
if (-not $appBuildVersion) {
    throw "APP_BUILD_VERSION bos olamaz."
}

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
