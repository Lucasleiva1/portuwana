param(
    [Parameter(Mandatory = $true)]
    [string]$Python,
    [Parameter(Mandatory = $true)]
    [string]$ModelSource
)

$ErrorActionPreference = "Stop"
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $toolDir "..\..")).Path
$binaryRoot = Join-Path $projectRoot "src-tauri\binaries\faster-whisper"
$modelRoot = Join-Path $projectRoot "src-tauri\resources\models\faster-whisper-small"
$buildRoot = Join-Path $projectRoot ".faster-whisper-build"
$resolvedPython = (Resolve-Path -LiteralPath $Python).Path
$resolvedModel = (Resolve-Path -LiteralPath $ModelSource).Path

foreach ($target in @($binaryRoot, $modelRoot, $buildRoot)) {
    $fullTarget = [System.IO.Path]::GetFullPath($target)
    if (-not $fullTarget.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Destino fuera del proyecto: $fullTarget"
    }
}

if (Test-Path -LiteralPath $buildRoot) {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $buildRoot | Out-Null

& $resolvedPython -m PyInstaller `
    --noconfirm `
    --clean `
    --distpath (Join-Path $buildRoot "dist") `
    --workpath (Join-Path $buildRoot "work") `
    (Join-Path $toolDir "portuwana-faster-whisper.spec")
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller falló con código $LASTEXITCODE"
}

$builtRuntime = Join-Path $buildRoot "dist\portuwana-faster-whisper"
if (-not (Test-Path -LiteralPath (Join-Path $builtRuntime "portuwana-faster-whisper.exe"))) {
    throw "PyInstaller no generó el worker esperado"
}

$duplicateNvidia = Join-Path $builtRuntime "_internal\nvidia"
if (Test-Path -LiteralPath $duplicateNvidia) {
    $resolvedDuplicate = (Resolve-Path -LiteralPath $duplicateNvidia).Path
    if (-not $resolvedDuplicate.StartsWith($builtRuntime, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Runtime NVIDIA duplicado fuera del build: $resolvedDuplicate"
    }
    Remove-Item -LiteralPath $resolvedDuplicate -Recurse -Force
}

New-Item -ItemType Directory -Path $binaryRoot -Force | Out-Null
Get-ChildItem -LiteralPath $binaryRoot -Force | Where-Object Name -ne "README.md" | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $builtRuntime -Force | Move-Item -Destination $binaryRoot -Force

New-Item -ItemType Directory -Path $modelRoot -Force | Out-Null
Get-ChildItem -LiteralPath $modelRoot -Force | Where-Object Name -ne "README.md" | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $resolvedModel -Force | Copy-Item -Destination $modelRoot -Recurse -Force

$binaryBytes = (Get-ChildItem -LiteralPath $binaryRoot -Recurse -File | Measure-Object Length -Sum).Sum
$modelBytes = (Get-ChildItem -LiteralPath $modelRoot -Recurse -File | Measure-Object Length -Sum).Sum
[pscustomobject]@{
    WorkerPath = $binaryRoot
    WorkerMiB = [math]::Round($binaryBytes / 1MB, 1)
    ModelPath = $modelRoot
    ModelMiB = [math]::Round($modelBytes / 1MB, 1)
}
