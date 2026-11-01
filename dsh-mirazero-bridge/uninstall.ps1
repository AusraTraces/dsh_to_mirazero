param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop"
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-mirazero-bridge'
$pkgPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $pkgPath)) { throw "Profile package.json not found: $pkgPath" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgPath "$pkgPath.bak-mirazero-remove-$stamp"

$pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
if ($pkg.dependencies -and $pkg.dependencies.PSObject.Properties.Name -contains $packageName) {
  $pkg.dependencies.PSObject.Properties.Remove($packageName)
}
$bundles = @($pkg.dsh.profile.bundles) | Where-Object { $_ -ne $packageName }
$pkg.dsh.profile.bundles = @($bundles)

$pkg | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $pkgPath -Encoding UTF8
Write-Host "Removed $packageName from $pkgPath (backup: $pkgPath.bak-mirazero-remove-$stamp)"

Push-Location $ProfileDir
try {
  $pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($pnpmCmd) {
    & $pnpmCmd.Source install
  } else {
    $pnpmJs = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
    if (Test-Path $pnpmJs) { & node $pnpmJs install }
  }
} finally {
  Pop-Location
}

Write-Host 'Restart DeepSeek Harness to unload the bundle.'
