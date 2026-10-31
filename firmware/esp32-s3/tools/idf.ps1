# Windows helper: stage Unicode workspace paths into an ASCII build directory.
# For other platforms, run the usual idf.py commands in firmware/esp32-s3.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$IdfArgs = @('build'))
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$stage = if ($env:NTNU_IDF_BUILD_DIR) { $env:NTNU_IDF_BUILD_DIR } else { 'C:\esp\ntnu-iot-firmware' }
$stage = [System.IO.Path]::GetFullPath($stage)
$marker = Join-Path $stage '.source-path'
if (Test-Path -LiteralPath $stage) {
    if (!(Test-Path -LiteralPath $marker) -or (Get-Content $marker -Raw -Encoding UTF8).Trim() -ne $sourceRoot) {
        throw "Build directory belongs to another project: $stage. Set NTNU_IDF_BUILD_DIR."
    }
} else {
    New-Item -ItemType Directory -Path $stage | Out-Null
    Set-Content $marker $sourceRoot -Encoding UTF8
}
if (!(Test-Path (Join-Path $sourceRoot 'main\app_config.h'))) {
    Copy-Item (Join-Path $sourceRoot 'main\app_config.example.h') (Join-Path $sourceRoot 'main\app_config.h')
}
foreach ($name in @('CMakeLists.txt', 'sdkconfig.defaults', 'dependencies.lock', 'sdkconfig')) {
    $item = Join-Path $sourceRoot $name
    if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination $stage -Force }
}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'main') -Destination $stage -Recurse -Force
$env:PYTHONUTF8 = '1'
if (!$env:IDF_PATH) {
    $activation = 'C:\Espressif\tools\Microsoft.v6.1.PowerShell_profile.ps1'
    if (!(Test-Path $activation)) { throw 'Run from an ESP-IDF 6.1 PowerShell terminal first.' }
    . $activation
}
$pythonExe = if ($env:IDF_PYTHON_ENV_PATH) { Join-Path $env:IDF_PYTHON_ENV_PATH 'Scripts\python.exe' } else { 'python' }
& $pythonExe (Join-Path $env:IDF_PATH 'tools\idf.py') -C $stage @IdfArgs
$result = $LASTEXITCODE
foreach ($name in @('sdkconfig', 'dependencies.lock')) {
    if (Test-Path (Join-Path $stage $name)) { Copy-Item (Join-Path $stage $name) $sourceRoot -Force }
}
exit $result
