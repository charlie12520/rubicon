$ErrorActionPreference = "Stop"

$appRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$node = (Get-Command node.exe).Source
$googleServiceAccountPath = [Environment]::GetEnvironmentVariable("GOOGLE_SERVICE_ACCOUNT_PATH", "User")
if (-not $googleServiceAccountPath) {
  $candidateGoogleServiceAccountPath = Join-Path $appRoot "..\.secrets\spx-replay-google-service-account.json"
  if (Test-Path -LiteralPath $candidateGoogleServiceAccountPath) {
    $googleServiceAccountPath = (Resolve-Path $candidateGoogleServiceAccountPath).Path
  }
}
if ($googleServiceAccountPath -and (Test-Path -LiteralPath $googleServiceAccountPath)) {
  $env:GOOGLE_SERVICE_ACCOUNT_PATH = $googleServiceAccountPath
}

Start-Process `
  -FilePath $node `
  -ArgumentList @("scripts\launch-desktop.mjs") `
  -WorkingDirectory $appRoot `
  -WindowStyle Hidden
