param(
    [Parameter(Mandatory = $true)]
    [string]$FemaleSheet,

    [Parameter(Mandatory = $true)]
    [string]$MaleSheet,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

if (-not ("Portuwana.ChromaKeySpriteBuilder" -as [type])) {
    $drawingReferences = @(
        [System.Drawing.Bitmap].Assembly.Location,
        [System.Drawing.Rectangle].Assembly.Location,
        [System.Reflection.Assembly]::Load("System.Private.Windows.GdiPlus").Location,
        [System.Reflection.Assembly]::Load("System.Private.Windows.Core").Location
    )
    Add-Type -ReferencedAssemblies $drawingReferences -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace Portuwana
{
    public static class ChromaKeySpriteBuilder
    {
        private static readonly string[] States =
        {
            "neutral",
            "blink",
            "question",
            "laugh"
        };

        public static void Build(string sheetPath, string outputDirectory, string character)
        {
            using (var source = new Bitmap(sheetPath))
            {
                if (source.Width % 2 != 0 || source.Height % 2 != 0)
                {
                    throw new InvalidDataException("The animation sheet must be an even 2x2 grid.");
                }

                var frameWidth = source.Width / 2;
                var frameHeight = source.Height / 2;

                for (var index = 0; index < States.Length; index += 1)
                {
                    var column = index % 2;
                    var row = index / 2;
                    using (var frame = ExtractFrame(
                        source,
                        column * frameWidth,
                        row * frameHeight,
                        frameWidth,
                        frameHeight))
                    {
                        var outputPath = Path.Combine(
                            outputDirectory,
                            string.Format(
                                "dictionary-assistant-{0}-{1}-v1.png",
                                character,
                                States[index]));
                        frame.Save(outputPath, ImageFormat.Png);
                    }
                }
            }
        }

        private static Bitmap ExtractFrame(
            Bitmap sheet,
            int originX,
            int originY,
            int width,
            int height)
        {
            var source = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (var graphics = Graphics.FromImage(source))
            {
                graphics.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                graphics.DrawImage(
                    sheet,
                    new Rectangle(0, 0, width, height),
                    new Rectangle(originX, originY, width, height),
                    GraphicsUnit.Pixel);
            }

            var result = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            var bounds = new Rectangle(0, 0, width, height);
            var sourceData = source.LockBits(bounds, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            var resultData = result.LockBits(bounds, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);

            try
            {
                var sourceBytes = new byte[Math.Abs(sourceData.Stride) * height];
                var resultBytes = new byte[Math.Abs(resultData.Stride) * height];
                Marshal.Copy(sourceData.Scan0, sourceBytes, 0, sourceBytes.Length);

                var keyBlue = sourceBytes[0];
                var keyGreen = sourceBytes[1];
                var keyRed = sourceBytes[2];

                for (var y = 0; y < height; y += 1)
                {
                    for (var x = 0; x < width; x += 1)
                    {
                        var sourceOffset = y * sourceData.Stride + x * 4;
                        var resultOffset = y * resultData.Stride + x * 4;
                        var blue = sourceBytes[sourceOffset];
                        var green = sourceBytes[sourceOffset + 1];
                        var red = sourceBytes[sourceOffset + 2];

                        var redDelta = red - keyRed;
                        var greenDelta = green - keyGreen;
                        var blueDelta = blue - keyBlue;
                        var distance = Math.Sqrt(
                            redDelta * redDelta
                            + greenDelta * greenDelta
                            + blueDelta * blueDelta);

                        var alpha = SmoothStep(40.0, 150.0, distance);
                        if (alpha <= 0.001)
                        {
                            resultBytes[resultOffset] = 0;
                            resultBytes[resultOffset + 1] = 0;
                            resultBytes[resultOffset + 2] = 0;
                            resultBytes[resultOffset + 3] = 0;
                            continue;
                        }

                        var outputBlue = RemoveBackground(blue, keyBlue, alpha);
                        var outputGreen = RemoveBackground(green, keyGreen, alpha);
                        var outputRed = RemoveBackground(red, keyRed, alpha);

                        var magentaExcess = Math.Min(
                            outputRed - outputGreen,
                            outputBlue - outputGreen);
                        if (magentaExcess > 24)
                        {
                            var spillStrength = Math.Min(1.0, (magentaExcess - 24.0) / 72.0);
                            var neutralRed = Math.Min(outputRed, outputGreen + 16);
                            outputRed = (byte)Math.Round(
                                outputRed + (neutralRed - outputRed) * spillStrength);
                        }

                        resultBytes[resultOffset] = outputBlue;
                        resultBytes[resultOffset + 1] = outputGreen;
                        resultBytes[resultOffset + 2] = outputRed;
                        resultBytes[resultOffset + 3] = (byte)Math.Round(alpha * 255.0);
                    }
                }

                Marshal.Copy(resultBytes, 0, resultData.Scan0, resultBytes.Length);
            }
            finally
            {
                source.UnlockBits(sourceData);
                result.UnlockBits(resultData);
                source.Dispose();
            }

            return result;
        }

        private static double SmoothStep(double lower, double upper, double value)
        {
            var normalized = Math.Max(0.0, Math.Min(1.0, (value - lower) / (upper - lower)));
            return normalized * normalized * (3.0 - 2.0 * normalized);
        }

        private static byte RemoveBackground(byte observed, byte background, double alpha)
        {
            if (alpha < 0.03)
            {
                return 0;
            }

            var foreground = (observed - (1.0 - alpha) * background) / alpha;
            return (byte)Math.Round(Math.Max(0.0, Math.Min(255.0, foreground)));
        }
    }
}
"@
}

$femalePath = (Resolve-Path -LiteralPath $FemaleSheet).Path
$malePath = (Resolve-Path -LiteralPath $MaleSheet).Path

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path

[Portuwana.ChromaKeySpriteBuilder]::Build($femalePath, $resolvedOutput, "female")
[Portuwana.ChromaKeySpriteBuilder]::Build($malePath, $resolvedOutput, "male")

Get-ChildItem -LiteralPath $resolvedOutput -Filter "dictionary-assistant-*-v1.png" |
    Sort-Object Name |
    Select-Object Name, Length
