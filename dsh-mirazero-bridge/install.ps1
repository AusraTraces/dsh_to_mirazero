param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$PluginDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$packageName = 'dsh-mirazero-bridge'
$pkgPath = Join-Path $ProfileDir 'package.json'

if (-not (Test-Path $pkgPath)) {
  throw "Profile package.json not found: $pkgPath"
}
if (-not (Test-Path (Join-Path $PluginDir 'package.json'))) {
  throw "Plugin package.json not found in: $PluginDir"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgPath "$pkgPath.bak-mirazero-$stamp"
$lockPath = Join-Path $ProfileDir 'pnpm-lock.yaml'
if (Test-Path $lockPath) {
  Copy-Item $lockPath "$lockPath.bak-mirazero-$stamp"
}

$pkg = Get-Content -Raw -LiteralPath $pkgPath | ConvertFrom-Json
if (-not $pkg.dependencies) {
  $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
}
$pkg.dependencies | Add-Member -NotePropertyName $packageName -NotePropertyValue "file:$PluginDir" -Force

$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains $packageName) {
  $pkg.dsh.profile.bundles = @($bundles + $packageName)
}

$pkg | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $pkgPath -Encoding UTF8
Write-Host "Updated $pkgPath (backup: $pkgPath.bak-mirazero-$stamp)"

Push-Location $ProfileDir
try {
  $pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($pnpmCmd) {
    & $pnpmCmd.Source install
  } else {
    $pnpmJs = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
    if (-not (Test-Path $pnpmJs)) {
      throw "pnpm not found. Run 'pnpm install' in $ProfileDir manually."
    }
    & node $pnpmJs install
  }
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$linked = Join-Path $ProfileDir "node_modules\$packageName\package.json"
if (Test-Path $linked) {
  Write-Host "Installed: $linked"
} else {
  Write-Warning "pnpm finished but $linked is missing; check the profile's node_modules."
}

Write-Host ''
Write-Host 'Next:'
Write-Host '  1. Open DSH Settings -> MiraZero and fill the site address + mzi_ key.'
Write-Host '     The same values can be set in the plugin row (baseUrl / apiKey).'
Write-Host '  2. Copy mirazero-patch/server/api/plugin/dsh into the MiraZero repo'
Write-Host '     and rebuild the site (the new version only ships the client API).'
Write-Host '  3. Restart DeepSeek Harness so the new bundle is composed.'
Write-Host '  4. In DSH run: mirazero_status, then mirazero_start.'
