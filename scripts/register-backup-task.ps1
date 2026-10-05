<#
.SYNOPSIS
  Registers the daily backup task for the CURRENT user (Production Readiness Unit 5).
  Run by the Owner, once, in his own terminal. No elevation needed.

.DESCRIPTION
  Task "AI Investment Copilot backup":
    - daily at 03:00 (local time)
    - runs only when the user is logged on (the app database is in the user's Docker)
    - start when available: a run missed while the machine was off or asleep starts
      as soon as the machine is available again
    - one instance at a time; allowed on battery
    - action: powershell.exe -File scripts\backup-scheduled.ps1 -Mode Run
  The task runs as the current user, so the DPAPI-protected passphrase (created by
  `backup-scheduled.ps1 -Mode SetupPassphrase`) can be read.

  It prints the task definition and does nothing else: no backup is started. If the
  task already exists it stops and says so (use -Replace to overwrite it).
  -PrintOnly builds and prints the definition without registering anything.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1 -PrintOnly
  Unregister-ScheduledTask -TaskName 'AI Investment Copilot backup' -Confirm:$false   # to remove it
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'AI Investment Copilot backup',
  [string]$At = '03:00',
  [switch]$Replace,
  [switch]$PrintOnly
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'backup-scheduled.ps1'))
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "not found: $script" }

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$user = '{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME

$action = New-ScheduledTaskAction -Execute $psExe -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Mode Run' -f $script) -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Daily encrypted database backup with an off-machine copy (scripts/backup-scheduled.ps1 -Mode Run). Weekly RestoreTest on Sunday.'

if (-not $PrintOnly) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing -and -not $Replace) {
    Write-Host "A task named '$TaskName' already exists. Nothing was changed. Use -Replace to overwrite it."
    exit 1
  }
  [void](Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force:$Replace)
}

Write-Host ''
Write-Host $(if ($PrintOnly) { "PRINT ONLY - task '$TaskName' was NOT registered. Definition:" } else { "Task '$TaskName' registered. Definition:" })
Write-Host ("  user:            {0} (logon type: run only when the user is logged on, limited rights)" -f $user)
Write-Host ("  trigger:         daily at {0}" -f $At)
Write-Host ("  start when available (run a missed run when the machine is back): {0}" -f $settings.StartWhenAvailable)
Write-Host ("  multiple instances: {0}; time limit: {1}" -f $settings.MultipleInstances, $settings.ExecutionTimeLimit)
Write-Host ("  action:          {0} {1}" -f $action.Execute, $action.Arguments)
Write-Host ("  working folder:  {0}" -f $action.WorkingDirectory)
if (-not $PrintOnly) {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host ("  next run:        {0}" -f $info.NextRunTime)
  Write-Host ''
  Write-Host ("Nothing was started. To test now (the app must be closed): Start-ScheduledTask -TaskName '{0}'" -f $TaskName)
}
exit 0
