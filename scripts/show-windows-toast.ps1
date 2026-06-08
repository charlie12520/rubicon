param(
  [string]$AppId = "auto",
  [string]$Title = "Rubicon alert",
  [string]$Body = "",
  [string]$Detail = "",
  [ValidateSet("short", "long")]
  [string]$Duration = "short"
)

if ([string]::IsNullOrWhiteSpace($Body)) {
  throw "Toast body is required."
}

function Resolve-RubiconToastAppId {
  param([string]$RequestedAppId)

  $requested = ($RequestedAppId -replace "\s+", " ").Trim()
  if ($requested -and $requested -ne "auto") {
    return $requested
  }

  try {
    $rubiconApps = @(Get-StartApps | Where-Object { $_.Name -eq "Rubicon" })
    $edgeApp = $rubiconApps | Where-Object { $_.AppID -like "*!App" } | Select-Object -First 1
    if ($edgeApp) {
      return $edgeApp.AppID
    }

    $shortcutApp = $rubiconApps | Where-Object { $_.AppID -eq "Rubicon.RubiconApp" } | Select-Object -First 1
    if ($shortcutApp) {
      return $shortcutApp.AppID
    }
  } catch {
    # Older shells can lack Get-StartApps; fall through to the installed shortcut AppID.
  }

  return "Rubicon.RubiconApp"
}

$ResolvedAppId = Resolve-RubiconToastAppId $AppId

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

function ConvertTo-ToastText {
  param([string]$Value)
  return [System.Security.SecurityElement]::Escape(($Value -replace "\s+", " ").Trim())
}

$textNodes = @(
  "<text>$(ConvertTo-ToastText $Title)</text>",
  "<text>$(ConvertTo-ToastText $Body)</text>"
)

if (-not [string]::IsNullOrWhiteSpace($Detail)) {
  $textNodes += "<text>$(ConvertTo-ToastText $Detail)</text>"
}

$toastXml = @"
<toast duration="$Duration">
  <visual>
    <binding template="ToastGeneric">
      $($textNodes -join "`n      ")
    </binding>
  </visual>
</toast>
"@

$xmlDocument = [Windows.Data.Xml.Dom.XmlDocument]::new()
$xmlDocument.LoadXml($toastXml)

$toast = [Windows.UI.Notifications.ToastNotification]::new($xmlDocument)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($ResolvedAppId)
$notifier.Show($toast)
Write-Output $ResolvedAppId
