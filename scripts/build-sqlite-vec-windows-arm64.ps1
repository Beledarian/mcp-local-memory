param(
    [string]$Version = "0.1.9"
)

$ErrorActionPreference = "Stop"

if ($Version -ne "0.1.9") {
    throw "Update the source checksum and provenance before building another version."
}

$sourceSha256 = "b87cdda12112657ba5ab8842f0088a4090982eaf41f22b2bd6d495b81765a8c9"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sqliteHeaderDir = Join-Path $repoRoot "node_modules\better-sqlite3\deps\sqlite3"
$outputDir = Join-Path $repoRoot "vendor\sqlite-vec\windows-arm64"
$tempRoot = [System.IO.Path]::GetTempPath()
$buildDir = Join-Path $tempRoot ("mcp-local-memory-sqlite-vec-" + [guid]::NewGuid().ToString("N"))

if (!(Test-Path -LiteralPath (Join-Path $sqliteHeaderDir "sqlite3ext.h"))) {
    throw "sqlite3ext.h is missing. Run npm install before building."
}

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (!(Test-Path -LiteralPath $vswhere)) {
    throw "Visual Studio Installer vswhere.exe was not found."
}

$visualStudio = & $vswhere `
    -latest `
    -products "*" `
    -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 `
    -property installationPath
if (!$visualStudio) {
    throw "The Visual Studio C++ ARM64 build tools are not installed."
}

$vcvars = Join-Path $visualStudio "VC\Auxiliary\Build\vcvarsall.bat"
$archive = Join-Path $buildDir "sqlite-vec-$Version-amalgamation.zip"
$sourceDir = Join-Path $buildDir "source"
$builtDll = Join-Path $outputDir "vec0.dll"
$url = "https://github.com/asg017/sqlite-vec/releases/download/v$Version/sqlite-vec-$Version-amalgamation.zip"

New-Item -ItemType Directory -Path $buildDir | Out-Null
try {
    Invoke-WebRequest -Uri $url -OutFile $archive
    $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $sourceSha256) {
        throw "sqlite-vec source checksum mismatch: $actualSha256"
    }

    Expand-Archive -LiteralPath $archive -DestinationPath $sourceDir
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    $compile = (
        '"' + $vcvars + '" arm64' +
        ' && cd /d "' + $sourceDir + '"' +
        ' && cl.exe /nologo /O2 /LD /I"' + $sqliteHeaderDir + '"' +
        ' sqlite-vec.c /link /Brepro /OUT:"' + $builtDll + '"'
    )
    & cmd.exe /d /s /c $compile
    if ($LASTEXITCODE -ne 0) {
        throw "MSVC failed with exit code $LASTEXITCODE."
    }

    $outputPath = $builtDll
    $outputHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath).Hash.ToLowerInvariant()
    Write-Output "Built sqlite-vec $Version for Windows ARM64:"
    Write-Output $outputPath
    Write-Output "SHA256 $outputHash"
}
finally {
    $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
    $resolvedBuildDir = [System.IO.Path]::GetFullPath($buildDir)
    if (
        $resolvedBuildDir.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedBuildDir).StartsWith("mcp-local-memory-sqlite-vec-")
    ) {
        Remove-Item -LiteralPath $resolvedBuildDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
