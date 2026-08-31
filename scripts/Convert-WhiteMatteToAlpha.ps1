param(
  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [string]$Destination,

  [int]$BackgroundMinimum = 210,
  [int]$BackgroundMaximumChroma = 55
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing.Common

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$destinationDirectory = [System.IO.Path]::GetDirectoryName($destinationPath)
if ($destinationDirectory) {
  [System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null
}

$input = [System.Drawing.Bitmap]::new($sourcePath)
$output = [System.Drawing.Bitmap]::new(
  $input.Width,
  $input.Height,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)

try {
  $graphics = [System.Drawing.Graphics]::FromImage($output)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.DrawImageUnscaled($input, 0, 0)
  }
  finally {
    $graphics.Dispose()
  }

  $bounds = [System.Drawing.Rectangle]::new(0, 0, $output.Width, $output.Height)
  $data = $output.LockBits(
    $bounds,
    [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )

  try {
    $width = $output.Width
    $height = $output.Height
    $pixelCount = $width * $height
    $byteCount = [Math]::Abs($data.Stride) * $height
    $pixels = [byte[]]::new($byteCount)
    [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $byteCount)

    $candidate = [bool[]]::new($pixelCount)
    $background = [bool[]]::new($pixelCount)

    for ($y = 0; $y -lt $height; $y += 1) {
      for ($x = 0; $x -lt $width; $x += 1) {
        $pixelIndex = ($y * $width) + $x
        $byteOffset = ($y * $data.Stride) + ($x * 4)
        $blue = [int]$pixels[$byteOffset]
        $green = [int]$pixels[$byteOffset + 1]
        $red = [int]$pixels[$byteOffset + 2]
        $minimum = [Math]::Min($red, [Math]::Min($green, $blue))
        $maximum = [Math]::Max($red, [Math]::Max($green, $blue))
        $candidate[$pixelIndex] =
          $minimum -ge $BackgroundMinimum -and
          ($maximum - $minimum) -le $BackgroundMaximumChroma
      }
    }

    $queue = [Collections.Generic.Queue[int]]::new()
    for ($x = 0; $x -lt $width; $x += 1) {
      foreach ($y in @(0, ($height - 1))) {
        $index = ($y * $width) + $x
        if ($candidate[$index] -and -not $background[$index]) {
          $background[$index] = $true
          $queue.Enqueue($index)
        }
      }
    }
    for ($y = 1; $y -lt ($height - 1); $y += 1) {
      foreach ($x in @(0, ($width - 1))) {
        $index = ($y * $width) + $x
        if ($candidate[$index] -and -not $background[$index]) {
          $background[$index] = $true
          $queue.Enqueue($index)
        }
      }
    }

    while ($queue.Count -gt 0) {
      $index = $queue.Dequeue()
      $x = $index % $width
      $y = [Math]::Floor($index / $width)
      foreach ($neighbor in @(
        @(($x - 1), $y),
        @(($x + 1), $y),
        @($x, ($y - 1)),
        @($x, ($y + 1))
      )) {
        $neighborX = $neighbor[0]
        $neighborY = $neighbor[1]
        if (
          $neighborX -lt 0 -or $neighborX -ge $width -or
          $neighborY -lt 0 -or $neighborY -ge $height
        ) {
          continue
        }
        $neighborIndex = ($neighborY * $width) + $neighborX
        if ($candidate[$neighborIndex] -and -not $background[$neighborIndex]) {
          $background[$neighborIndex] = $true
          $queue.Enqueue($neighborIndex)
        }
      }
    }

    $edgeRing = [byte[]]::new($pixelCount)
    for ($y = 0; $y -lt $height; $y += 1) {
      for ($x = 0; $x -lt $width; $x += 1) {
        $index = ($y * $width) + $x
        if ($background[$index]) {
          $byteOffset = ($y * $data.Stride) + ($x * 4)
          $pixels[$byteOffset + 3] = 0
          continue
        }
        $touchesBackground = $false
        for ($offsetY = -1; $offsetY -le 1 -and -not $touchesBackground; $offsetY += 1) {
          for ($offsetX = -1; $offsetX -le 1; $offsetX += 1) {
            $neighborX = $x + $offsetX
            $neighborY = $y + $offsetY
            if (
              $neighborX -ge 0 -and $neighborX -lt $width -and
              $neighborY -ge 0 -and $neighborY -lt $height -and
              $background[($neighborY * $width) + $neighborX]
            ) {
              $touchesBackground = $true
              break
            }
          }
        }
        if ($touchesBackground) {
          $edgeRing[$index] = 1
        }
      }
    }

    for ($y = 0; $y -lt $height; $y += 1) {
      for ($x = 0; $x -lt $width; $x += 1) {
        $index = ($y * $width) + $x
        if ($edgeRing[$index] -ne 1) {
          continue
        }
        $byteOffset = ($y * $data.Stride) + ($x * 4)
        $blue = [int]$pixels[$byteOffset]
        $green = [int]$pixels[$byteOffset + 1]
        $red = [int]$pixels[$byteOffset + 2]
        $minimum = [Math]::Min($red, [Math]::Min($green, $blue))
        $maximum = [Math]::Max($red, [Math]::Max($green, $blue))
        $neutrality = 1.0 - [Math]::Min(1.0, ($maximum - $minimum) / 60.0)
        $brightness = [Math]::Max(0.0, [Math]::Min(1.0, ($minimum - 155.0) / 90.0))
        $alpha = [Math]::Max(0.18, 1.0 - (0.72 * $neutrality * $brightness))
        $pixels[$byteOffset + 3] = [byte][Math]::Round(255.0 * $alpha)

        if ($alpha -lt 0.99) {
          $matte = 250.0
          $pixels[$byteOffset] = [byte][Math]::Round(
            [Math]::Max(0.0, [Math]::Min(255.0, ($blue - ((1.0 - $alpha) * $matte)) / $alpha))
          )
          $pixels[$byteOffset + 1] = [byte][Math]::Round(
            [Math]::Max(0.0, [Math]::Min(255.0, ($green - ((1.0 - $alpha) * $matte)) / $alpha))
          )
          $pixels[$byteOffset + 2] = [byte][Math]::Round(
            [Math]::Max(0.0, [Math]::Min(255.0, ($red - ((1.0 - $alpha) * $matte)) / $alpha))
          )
        }
      }
    }

    [Runtime.InteropServices.Marshal]::Copy($pixels, 0, $data.Scan0, $byteCount)
  }
  finally {
    $output.UnlockBits($data)
  }

  $output.Save($destinationPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  $output.Dispose()
  $input.Dispose()
}

$result = Get-Item -LiteralPath $destinationPath
Write-Output "Created $($result.FullName) ($($result.Length) bytes)"
