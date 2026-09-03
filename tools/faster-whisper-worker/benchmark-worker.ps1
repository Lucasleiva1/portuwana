param(
    [Parameter(Mandatory = $true)]
    [string]$Audio,
    [ValidateSet("cuda", "cpu")]
    [string]$Device = "cuda",
    [ValidateRange(1, 20)]
    [int]$Runs = 3,
    [ValidateSet("base", "small")]
    [string]$ModelName = "small",
    [ValidateSet("pt", "es", "auto")]
    [string]$Language = "es",
    [switch]$ExpectNoSpeech,
    [string]$Worker,
    [string]$Model
)

$ErrorActionPreference = "Stop"
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $toolDir "..\..")).Path
if (-not $Worker) {
    $Worker = Join-Path $projectRoot "src-tauri\binaries\faster-whisper\portuwana-faster-whisper.exe"
}
if (-not $Model) {
    $Model = Join-Path $projectRoot "src-tauri\resources\models\faster-whisper-small"
}

$resolvedWorker = (Resolve-Path -LiteralPath $Worker).Path
$resolvedModel = (Resolve-Path -LiteralPath $Model).Path
$resolvedAudio = (Resolve-Path -LiteralPath $Audio).Path
$requestRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("portuwana-faster-whisper-benchmark-" + [guid]::NewGuid().ToString("N"))
$statusPath = Join-Path $requestRoot "status.json"
$audioPath = Join-Path $requestRoot "audio.wav"
New-Item -ItemType Directory -Path $requestRoot | Out-Null
Copy-Item -LiteralPath $resolvedAudio -Destination $audioPath

$arguments = @(
    "--model-path", ('"' + $resolvedModel + '"'),
    "--model-name", $ModelName,
    "--request-root", ('"' + $requestRoot + '"'),
    "--status-path", ('"' + $statusPath + '"'),
    "--preferred-device", $Device,
    "--gpu-compute-type", "int8_float32",
    "--cpu-compute-type", "int8"
) -join " "

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $resolvedWorker
$startInfo.Arguments = $arguments
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::new()
$process.StartInfo = $startInfo
$null = $process.Start()

try {
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (-not (Test-Path -LiteralPath $statusPath)) {
        if ($process.HasExited) {
            throw "El worker terminó durante la carga: $($process.StandardError.ReadToEnd())"
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "El worker no informó su estado dentro de 45 segundos."
        }
        Start-Sleep -Milliseconds 100
    }

    $status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
    if (-not $status.ready) {
        throw "El worker no quedó listo: $($status.error)"
    }

    $results = @()
    for ($index = 1; $index -le $Runs; $index++) {
        $responsePath = Join-Path $requestRoot ("response-{0}.json" -f $index)
        $command = @{
            op = "transcribe"
            requestId = "benchmark-$index"
            audioPath = $audioPath
            responsePath = $responsePath
            language = $Language
            initialPrompt = "Conversación cotidiana en español y portugués de Brasil."
            contextScope = "benchmark-$index"
        } | ConvertTo-Json -Compress
        $roundTrip = [System.Diagnostics.Stopwatch]::StartNew()
        $process.StandardInput.WriteLine($command)
        $process.StandardInput.Flush()
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        while (-not (Test-Path -LiteralPath $responsePath)) {
            if ($process.HasExited) {
                throw "El worker terminó durante la inferencia: $($process.StandardError.ReadToEnd())"
            }
            if ([DateTime]::UtcNow -ge $deadline) {
                throw "La inferencia $index superó 90 segundos."
            }
            Start-Sleep -Milliseconds 25
        }
        $roundTrip.Stop()
        $response = Get-Content -LiteralPath $responsePath -Raw | ConvertFrom-Json
        if ($response.status -ne "success" -and $ExpectNoSpeech) {
            [pscustomobject]@{
                ExpectedNoSpeech = $true
                Backend = $response.backend
                ComputeType = $response.computeType
                Message = $response.message
                FallbackReason = $response.fallbackReason
            } | Format-List
            return
        }
        if ($response.status -ne "success") {
            throw "La inferencia $index falló: $($response.message)"
        }
        $results += [pscustomobject]@{
            Run = $index
            Backend = $response.backend
            ComputeType = $response.computeType
            LoadMs = $response.loadMs
            InferenceMs = $response.inferenceMs
            RoundTripMs = $roundTrip.ElapsedMilliseconds
            Language = $response.language
            Text = $response.text
            FallbackReason = $response.fallbackReason
        }
    }

    $results | Format-Table -AutoSize
    $warmResults = if ($results.Count -gt 1) { $results | Select-Object -Skip 1 } else { $results }
    [pscustomobject]@{
        DeviceRequested = $Device
        Model = $ModelName
        LanguageRequested = $Language
        BackendUsed = $results[-1].Backend
        Runs = $Runs
        LoadMs = $results[0].LoadMs
        WarmInferenceAverageMs = [math]::Round(($warmResults | Measure-Object InferenceMs -Average).Average)
        WarmRoundTripAverageMs = [math]::Round(($warmResults | Measure-Object RoundTripMs -Average).Average)
        Transcript = $results[-1].Text
    } | Format-List
}
finally {
    if (-not $process.HasExited) {
        try {
            $process.StandardInput.WriteLine('{"op":"shutdown"}')
            $process.StandardInput.Flush()
            $process.WaitForExit(5000) | Out-Null
        }
        catch {
        }
    }
    if (-not $process.HasExited) {
        $process.Kill($true)
    }
    $process.Dispose()
    if (Test-Path -LiteralPath $requestRoot) {
        $resolvedRequestRoot = (Resolve-Path -LiteralPath $requestRoot).Path
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if ($resolvedRequestRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedRequestRoot -Recurse -Force
        }
    }
}
