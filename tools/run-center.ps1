# Run inside run-limited.ps1 so both services share the same Windows resource job.
param([int]$WebPort=18082)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPrivate=Join-Path $taskRoot '.private'
New-Item -ItemType Directory -Force -Path $taskPrivate | Out-Null
$env:API_PORT='3001'
$env:COLLECTOR_WS_PORT='3002'
$env:DB_PATH=Join-Path $taskPrivate 'stats.db'
$env:GEOIP_ALLOW_ONLINE='0'
$env:FORCE_ACCESS_CONTROL_OFF='true'
$env:NODE_ENV='production'
$taskCollector=Start-Process node -ArgumentList 'dist/index.js' -WorkingDirectory (Join-Path $taskRoot 'apps/collector') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskPrivate 'collector.log') -RedirectStandardError (Join-Path $taskPrivate 'collector-error.log')
$taskWeb=Start-Process node -ArgumentList @('node_modules/next/dist/bin/next','start','-p',"$WebPort",'-H','0.0.0.0') -WorkingDirectory (Join-Path $taskRoot 'apps/web') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskPrivate 'web.log') -RedirectStandardError (Join-Path $taskPrivate 'web-error.log')
try { Wait-Process -Id @($taskCollector.Id,$taskWeb.Id) } finally {
 foreach($taskProcess in @($taskCollector,$taskWeb)) { if(-not $taskProcess.HasExited) { Stop-Process -Id $taskProcess.Id } }
}
