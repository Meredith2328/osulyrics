Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error '需要先安装 Node.js。'
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'))) {
    Write-Host '首次启动，正在安装桌面运行时...'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) {
        Write-Error '安装失败，请检查网络连接。'
        exit 1
    }
}

& npm.cmd start
exit $LASTEXITCODE
