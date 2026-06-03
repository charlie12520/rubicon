param(
  [string]$Title = "Rubicon calendar alert",
  [string]$Body = "Calendar event starts in 1 minute",
  [string]$Detail = "",
  [int]$DurationSeconds = 45
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Media.SystemSounds]::Exclamation.Play()

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$area = $screen.WorkingArea
$width = [Math]::Min(520, [Math]::Max(360, $area.Width - 80))
$height = 228
$x = $area.Left + [Math]::Max(24, [Math]::Floor(($area.Width - $width) / 2))
$y = $area.Top + [Math]::Max(24, [Math]::Floor(($area.Height - $height) / 3))

$form = New-Object System.Windows.Forms.Form
$form.Text = "Rubicon Calendar Alert"
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point($x, $y)
$form.Size = New-Object System.Drawing.Size($width, $height)
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(5, 7, 10)
$form.ForeColor = [System.Drawing.Color]::FromArgb(220, 231, 245)

$accent = [System.Drawing.Color]::FromArgb(45, 212, 191)
$muted = [System.Drawing.Color]::FromArgb(170, 183, 201)

$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $false
$label.Location = New-Object System.Drawing.Point(18, 16)
$label.Size = New-Object System.Drawing.Size(($width - 36), 22)
$label.Text = $Title.ToUpperInvariant()
$label.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$label.ForeColor = $accent
$form.Controls.Add($label)

$bodyLabel = New-Object System.Windows.Forms.Label
$bodyLabel.AutoSize = $false
$bodyLabel.Location = New-Object System.Drawing.Point(18, 46)
$bodyLabel.Size = New-Object System.Drawing.Size(($width - 36), 70)
$bodyLabel.Text = $Body
$bodyLabel.Font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$bodyLabel.ForeColor = [System.Drawing.Color]::FromArgb(248, 250, 252)
$form.Controls.Add($bodyLabel)

$detailLabel = New-Object System.Windows.Forms.Label
$detailLabel.AutoSize = $false
$detailLabel.Location = New-Object System.Drawing.Point(18, 122)
$detailLabel.Size = New-Object System.Drawing.Size(($width - 36), 40)
$detailLabel.Text = $Detail
$detailLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
$detailLabel.ForeColor = $muted
$form.Controls.Add($detailLabel)

$button = New-Object System.Windows.Forms.Button
$button.Location = New-Object System.Drawing.Point(18, 170)
$button.Size = New-Object System.Drawing.Size(106, 30)
$button.Text = "Dismiss"
$button.BackColor = [System.Drawing.Color]::FromArgb(18, 25, 34)
$button.ForeColor = [System.Drawing.Color]::FromArgb(220, 231, 245)
$button.FlatStyle = "Flat"
$button.Add_Click({ $form.Close() })
$form.Controls.Add($button)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(5, $DurationSeconds) * 1000
$timer.Add_Tick({
  $timer.Stop()
  $form.Close()
})

$form.Add_Shown({
  $form.Activate()
  $form.BringToFront()
  $timer.Start()
})

[void]$form.ShowDialog()
