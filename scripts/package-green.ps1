param(
  [string]$PackageName = "pricing-console-green"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path -LiteralPath "node_modules")) {
  throw "node_modules not found. Run npm.cmd install before packaging."
}

npm.cmd run build

$releaseDir = Join-Path $root "release"
$packageDir = Join-Path $releaseDir $PackageName
$zipPath = Join-Path $releaseDir "$PackageName.zip"

if (Test-Path -LiteralPath $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $packageDir | Out-Null

Copy-Item -LiteralPath "dist" -Destination (Join-Path $packageDir "dist") -Recurse
Copy-Item -LiteralPath "public" -Destination (Join-Path $packageDir "public") -Recurse
Copy-Item -LiteralPath "node_modules" -Destination (Join-Path $packageDir "node_modules") -Recurse
Copy-Item -LiteralPath "package.json" -Destination $packageDir
Copy-Item -LiteralPath "package-lock.json" -Destination $packageDir
Copy-Item -LiteralPath ".env.example" -Destination (Join-Path $packageDir ".env")

@"
@echo off
cd /d "%~dp0"
echo Starting pricing console...
echo.
echo Local URL: http://127.0.0.1:3210/
echo LAN URL: http://THIS-COMPUTER-IP:3210/
echo.
echo Keep this window open. Closing it stops the pricing console.
echo.
npm.cmd run start
pause
"@ | Set-Content -LiteralPath (Join-Path $packageDir "start-pricing-console.bat") -Encoding ASCII

@"
@echo off
start http://127.0.0.1:3210/
"@ | Set-Content -LiteralPath (Join-Path $packageDir "open-console.bat") -Encoding ASCII

@"
# Pricing Console Green Package

## How to use

1. Make sure Hubstudio is installed and logged in on this computer.
2. Double-click start-pricing-console.bat.
3. Open http://127.0.0.1:3210/ on this computer.
4. Other LAN computers can open http://THIS-COMPUTER-IP:3210/.

## Notes

- Opening COMPUTER-IP:3210 controls Hubstudio and the fingerprint browser on that computer.
- If LAN access fails, allow inbound TCP port 3210 in Windows Firewall.
- If node or npm is missing, install Node.js LTS first.
"@ | Set-Content -LiteralPath (Join-Path $packageDir "README.txt") -Encoding ASCII

Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -Force

Write-Host "Package created:"
Write-Host $packageDir
Write-Host $zipPath
