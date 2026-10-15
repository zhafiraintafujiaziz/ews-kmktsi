$ErrorActionPreference = 'Stop'

$taskProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskCollectorPath = Join-Path $PSScriptRoot 'collect-ispu.ts'
$taskNodePath = (Get-Command node -ErrorAction Stop).Source
if ((Get-TimeZone).Id -ne 'SE Asia Standard Time') {
    throw 'This task expects Windows timezone SE Asia Standard Time, UTC+07:00 WIB. Configure a matching 08:30 WIB trigger before registering on another timezone.'
}

$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try {
    $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskProjectRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 8).ToLowerInvariant()
} finally { $taskHasher.Dispose() }
$taskName = "EWS-KMKTSI-ISPU-$taskHash"
$taskDescription = "Daily local ISPU archive for $taskProjectRoot at 08:30 WIB. Managed by scripts/schedule-ispu.ps1."
$taskExisting = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($taskExisting -and $taskExisting.Description -ne $taskDescription) {
    throw "A different task already uses $taskName. It was not changed."
}

$taskAction = New-ScheduledTaskAction -Execute $taskNodePath -Argument ('--experimental-strip-types "{0}"' -f $taskCollectorPath) -WorkingDirectory $taskProjectRoot
$taskTrigger = New-ScheduledTaskTrigger -Daily -At '08:30'
$taskPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName $taskName -Description $taskDescription -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Force | Out-Null
$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{ TaskName = $taskName; NextRunTime = $taskInfo.NextRunTime.ToString('s'); TimeZone = 'Asia/Jakarta'; Database = 'local SQLite'; RequiresWindowsLogin = $true } | ConvertTo-Json -Compress
