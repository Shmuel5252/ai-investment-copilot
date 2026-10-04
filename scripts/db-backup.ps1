<#
.SYNOPSIS
  Local PostgreSQL backup, verification and restore-test routine for the
  Docker database defined in docker-compose.yml (Production Readiness Unit 2A).

.DESCRIPTION
  Modes:
    SelfTest     Destructive-name guard self-test. No Docker, no database.
    Backup       pg_dump -Fc of the live database into the backup root, plus a
                 .sha256 sidecar and a .meta.json sidecar holding the row counts
                 captured at the backup point. All three are written under
                 .partial names and validated first; the .dump is renamed to its
                 final name LAST, so a final .dump means a complete, validated set.
    Verify       Existence, size, SHA256, metadata binding (sha256 / file name /
                 size) and `pg_restore --list` of one dump. Restores nothing.
    RestoreTest  Restores one dump into a NEW throwaway database whose name this
                 run generates, compares row counts with the dump's metadata,
                 reports live drift separately, then drops ONLY that database.

  Safety rules (see docs/runbook-db-backup.md):
    - The live database is only ever read (pg_dump, read-only SELECTs). Every
      session opened by Invoke-Sql is read-only; it has no write mode.
    - CREATE/DROP DATABASE run only through the maintenance database "postgres".
    - The restore target name is generated internally and guarded. It becomes
      run-owned ONLY when this run's CREATE DATABASE exits 0; the drop function
      takes no target argument and never uses FORCE.
    - The binary dump is written and read INSIDE the container and moved with
      `docker cp`; it never passes through PowerShell text handling.
    - Temporary container copies are removed in finally blocks and checked.
    - The script never queries or prints row values, passwords or connection
      strings. Native tool errors are shown unfiltered so failures can be
      diagnosed; a PostgreSQL error can quote part of a row, so treat failure
      output as sensitive.
    - Nothing that existed before the run is ever deleted (no retention /
      pruning); a failed Backup removes only its own unpublished files.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode SelfTest
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode Backup
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode Verify -DumpPath <file.dump>
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode RestoreTest -DumpPath <file.dump>
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('SelfTest', 'Backup', 'Verify', 'RestoreTest')]
  [string]$Mode,

  # Where Backup writes. Must be outside the repository and not cloud-synced.
  [string]$BackupRoot = 'C:\dev-private\backups',

  # The dump to Verify / RestoreTest. Its .sha256 and .meta.json sidecars must sit next to it.
  [string]$DumpPath,

  # Explicit override to write into a detected cloud-synced folder. Off by default.
  [switch]$AllowCloudSyncedDestination
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- constants --
$MaintenanceDb = 'postgres'
$ProtectedDbNames = @('postgres', 'template0', 'template1')
$RestorePrefix = 'ai_investment_copilot_restore_test_'
$RestorePattern = '^ai_investment_copilot_restore_test_\d{8}t\d{6}z$'
$IdentifierPattern = '^[a-z_][a-z0-9_]{0,62}$'
$ManagedBy = 'scripts/db-backup.ps1'

$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ComposeFile = Join-Path $RepoRoot 'docker-compose.yml'

# Run state. The ONLY source for the drop target.
$script:RunState = @{ CreatedRestoreDb = $null }
$script:Checks = New-Object System.Collections.ArrayList

# ------------------------------------------------------------------ output --
function Write-Step([string]$Text) { Write-Host ''; Write-Host "== $Text" }
function Add-Check([string]$Name, [bool]$Pass, [string]$Detail = '') {
  [void]$script:Checks.Add([pscustomobject]@{ Check = $Name; Result = $(if ($Pass) { 'PASS' } else { 'FAIL' }); Detail = $Detail })
  $mark = if ($Pass) { 'PASS' } else { 'FAIL' }
  Write-Host ("  [{0}] {1}{2}" -f $mark, $Name, $(if ($Detail) { " - $Detail" } else { '' }))
}
function Stop-Run([string]$Reason) { throw "STOPPED: $Reason" }

# ------------------------------------------------------------ native calls --
# Runs a native command and returns its stdout lines. Throws on non-zero exit.
# stderr is left to the console (PowerShell 5.1 wraps redirected native stderr
# in error records, which would abort the script under ErrorActionPreference=Stop).
# $LASTEXITCODE is cleared first, so a stale value from an earlier call can never
# be read as this call's result; no exit code at all is a failure even with -AllowFailure.
function Invoke-Native([string]$Exe, [string[]]$ArgumentList, [string]$StdIn = $null, [switch]$AllowFailure) {
  $global:LASTEXITCODE = $null
  if ($null -ne $StdIn) { $out = $StdIn | & $Exe @ArgumentList } else { $out = & $Exe @ArgumentList }
  $code = $LASTEXITCODE
  if ($null -eq $code) { throw "$Exe reported no exit code" }
  if (-not $AllowFailure -and $code -ne 0) { throw "$Exe exited with code $code" }
  return [pscustomobject]@{ ExitCode = $code; Lines = @($out | ForEach-Object { "$_" }) }
}

# Runs SQL inside the container via psql on stdin (never as an argument, so
# PowerShell 5.1 cannot mangle quotes). Read-only by construction: every session
# starts with default_transaction_read_only = on and there is no switch to turn it
# off. The only writes in this script (CREATE/DROP of the throwaway restore
# database through "postgres") do not go through here.
function Invoke-Sql($Target, [string]$Database, [string]$Sql) {
  if ($Database -notmatch $IdentifierPattern) { throw "refusing SQL against invalid database name" }
  $text = "SET default_transaction_read_only = on;`n" + $Sql
  $r = Invoke-Native 'docker' @('exec', '-i', $Target.Container, 'psql', '-X', '-q', '-U', $Target.User, '-d', $Database, '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', '-') -StdIn $text
  return $r.Lines | Where-Object { $_ -ne '' }
}

# ------------------------------------------------------------ destructive guard --
function New-RestoreTestName {
  return $RestorePrefix + (Get-Date).ToUniversalTime().ToString('yyyyMMdd\tHHmmss\z')
}

# The single guard for the restore-test database name.
#   Phase Create: the name must not exist yet.
#   Phase Drop:   the name must be exactly the one this run created, and exist.
function Test-RestoreTargetName {
  param(
    [string]$Name,
    [string]$LiveDbName,
    [string[]]$ExistingDatabases,
    [string]$Phase,
    [string]$RunCreatedName,
    [string]$OperationMode,
    [bool]$ServerVerified
  )
  $refuse = { param($why) [pscustomobject]@{ Ok = $false; Reason = $why } }
  if ($OperationMode -ne 'RestoreTest') { return & $refuse 'not running in explicit restore-test mode' }
  if (-not $ServerVerified) { return & $refuse 'PostgreSQL server is not the verified local compose server' }
  if ([string]::IsNullOrWhiteSpace($Name)) { return & $refuse 'empty database name' }
  if ([string]::IsNullOrWhiteSpace($LiveDbName)) { return & $refuse 'live database name unknown' }
  if ($Name -ieq $LiveDbName) { return & $refuse 'name is the live database' }
  if ($ProtectedDbNames -icontains $Name) { return & $refuse 'name is a maintenance/template database' }
  if (-not $Name.StartsWith($RestorePrefix, [System.StringComparison]::Ordinal)) { return & $refuse 'name lacks the restore-test prefix' }
  if ($Name -cnotmatch $RestorePattern) { return & $refuse 'name does not match the exact restore-test pattern' }
  $exists = @($ExistingDatabases | Where-Object { $_ -ieq $Name }).Count -gt 0
  switch ($Phase) {
    'Create' {
      if ($exists) { return & $refuse 'database already exists' }
    }
    'Drop' {
      if ([string]::IsNullOrWhiteSpace($RunCreatedName) -or ($Name -cne $RunCreatedName)) { return & $refuse 'name was not created by this run' }
      if (-not $exists) { return & $refuse 'database not present in catalog' }
    }
    default { return & $refuse "unknown guard phase '$Phase'" }
  }
  return [pscustomobject]@{ Ok = $true; Reason = 'accepted' }
}

# ------------------------------------------------------------ server identity --
function Get-ComposeFacts {
  if (-not (Test-Path -LiteralPath $ComposeFile)) { Stop-Run 'docker-compose.yml not found' }
  $text = [System.IO.File]::ReadAllText($ComposeFile)
  $db = [regex]::Match($text, '(?m)^\s*POSTGRES_DB:\s*([A-Za-z0-9_]+)\s*$')
  $img = [regex]::Match($text, '(?m)^\s*image:\s*postgres:(\d+)')
  if (-not $db.Success -or -not $img.Success) { Stop-Run 'could not read POSTGRES_DB / postgres image from docker-compose.yml' }
  return [pscustomobject]@{ LiveDb = $db.Groups[1].Value; ImageMajor = [int]$img.Groups[1].Value }
}

function Get-DbTarget {
  $compose = Get-ComposeFacts
  $ps = Invoke-Native 'docker' @('compose', '-f', $ComposeFile, '--project-directory', $RepoRoot, 'ps', '--format', 'json')
  $svc = @($ps.Lines | Where-Object { $_.Trim().StartsWith('{') } | ForEach-Object { $_ | ConvertFrom-Json } |
      Where-Object { $_.Image -like 'postgres:*' -and $_.State -eq 'running' })
  if ($svc.Count -ne 1) { Stop-Run "expected exactly one running postgres service in the compose project, found $($svc.Count)" }
  $container = $svc[0].Name
  $envDb = (Invoke-Native 'docker' @('exec', $container, 'printenv', 'POSTGRES_DB')).Lines[0]
  $user = (Invoke-Native 'docker' @('exec', $container, 'printenv', 'POSTGRES_USER')).Lines[0]
  if ($envDb -ne $compose.LiveDb) { Stop-Run 'container POSTGRES_DB differs from docker-compose.yml' }
  if ($compose.LiveDb -notmatch $IdentifierPattern -or $user -notmatch $IdentifierPattern) { Stop-Run 'unexpected database/user identifier' }
  $t = [pscustomobject]@{ Container = $container; Service = $svc[0].Service; Image = $svc[0].Image; User = $user; LiveDb = $compose.LiveDb; Version = $null; Major = $null; Verified = $false }
  $row = @(Invoke-Sql $t $MaintenanceDb "SELECT current_setting('server_version'), current_setting('server_version_num')::int / 10000, (SELECT count(*) FROM pg_database WHERE datname = '$($t.LiveDb)');")[0].Split('|')
  $t.Version = $row[0]; $t.Major = [int]$row[1]
  if ($t.Major -ne $compose.ImageMajor) { Stop-Run "server major $($t.Major) differs from compose image major $($compose.ImageMajor)" }
  if ([int]$row[2] -ne 1) { Stop-Run 'live database not found on the server' }
  $t.Verified = $true
  return $t
}

function Get-DatabaseNames($Target) {
  return @(Invoke-Sql $Target $MaintenanceDb 'SELECT datname FROM pg_database ORDER BY datname;')
}

# Other client sessions on the live database (this check runs from "postgres", so it is never one of them).
function Assert-NoOtherSessions($Target) {
  $row = @(Invoke-Sql $Target $MaintenanceDb ("SELECT count(*), coalesce(string_agg(DISTINCT coalesce(nullif(application_name, ''), '(unnamed)'), ', '), '') " +
      "FROM pg_stat_activity WHERE datname = '$($Target.LiveDb)' AND pid <> pg_backend_pid() AND backend_type = 'client backend';"))[0].Split('|')
  $n = [int]$row[0]
  Add-Check 'active-session gate (no other sessions on the live database)' ($n -eq 0) ("other sessions: $n" + $(if ($n -gt 0) { " (applications: $($row[1]))" } else { '' }))
  if ($n -ne 0) { Stop-Run 'other sessions are connected to the live database; stop the dev server / clients first (sessions are never terminated by this script)' }
}

# Exact row count of every user table (schema.table -> count). Read-only.
function Get-TableCounts($Target, [string]$Database) {
  $sql = @'
SELECT format('%s.%s', n.nspname, c.relname),
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_toast%'
ORDER BY 1;
'@
  $counts = [ordered]@{}
  foreach ($line in (Invoke-Sql $Target $Database $sql)) { $p = $line.Split('|'); $counts[$p[0]] = [long]$p[1] }
  return $counts
}

# Migration ledger in apply order: drizzle's hash (sha256 of the file bytes) and
# created_at (drizzle stores the journal entry's "when" there).
function Get-Ledger($Target, [string]$Database) {
  return @(Invoke-Sql $Target $Database 'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id;' |
      ForEach-Object { $p = $_.Split('|'); [pscustomobject]@{ Hash = $p[0]; CreatedAt = $p[1] } })
}

# Repository migration identities in journal order (the "when" drizzle stores as
# created_at). Identity, not file bytes, so line-ending conversion never matters.
function Get-RepoMigrationIds {
  $journal = Get-Content -LiteralPath (Join-Path $RepoRoot 'src\db\migrations\meta\_journal.json') -Raw | ConvertFrom-Json
  return @($journal.entries | ForEach-Object { [string]$_.when })
}

# ------------------------------------------------------------ pure helpers (exercised by SelfTest) --
# Same strings, same order, same count.
function Test-SameOrdered([string[]]$A = @(), [string[]]$B = @()) {
  if ($A.Count -ne $B.Count) { return $false }
  for ($i = 0; $i -lt $A.Count; $i++) { if ($A[$i] -cne $B[$i]) { return $false } }
  return $true
}

# Informational: the backup's ledger vs the repository journal. Only a divergence
# inside the common prefix fails; a backup taken before later migrations does not.
function Compare-LedgerToRepo([string[]]$Backup = @(), [string[]]$Repo = @()) {
  $common = [Math]::Min($Backup.Count, $Repo.Count)
  for ($i = 0; $i -lt $common; $i++) {
    if ($Backup[$i] -cne $Repo[$i]) { return [pscustomobject]@{ Ok = $false; Text = "backup and repo ledgers diverge at migration #$($i + 1)" } }
  }
  $n = $Repo.Count - $Backup.Count
  $text = if ($n -eq 0) { 'backup ledger equals the repo ledger' } elseif ($n -gt 0) { "backup is $n migrations behind the repo" } else { "repo is $(-$n) migrations behind the backup" }
  return [pscustomobject]@{ Ok = $true; Text = $text }
}

# Reasons a .meta.json must NOT be accepted for one dump (no output = accepted).
function Test-BackupMetadata($Meta, [string]$DumpFileName, [string]$Sha256, [long]$Size) {
  $problems = @()
  foreach ($f in @('managedBy', 'formatVersion', 'dumpFile', 'sha256', 'dumpSizeBytes', 'rowCounts', 'migrationLedgerHashes')) {
    if ($null -eq $Meta -or -not $Meta.PSObject.Properties[$f]) { $problems += "missing field $f" }
  }
  if ($problems.Count) { return $problems }
  if ($Meta.managedBy -cne $ManagedBy -or $Meta.formatVersion -ne 1) { $problems += 'not a format-1 metadata file of this script' }
  if ("$($Meta.sha256)" -cne $Sha256) { $problems += 'sha256 differs from the dump' }
  if ("$($Meta.dumpFile)" -cne $DumpFileName) { $problems += 'dumpFile differs from the dump file name' }
  if ([long]$Meta.dumpSizeBytes -ne $Size) { $problems += 'dumpSizeBytes differs from the dump size' }
  return $problems
}

# Live drift is a separate report, never part of the restore verdict. When the live
# counts cannot be obtained the status is UNKNOWN with the reason; it never throws.
function Get-DriftReport($MetaCounts, $Target, [scriptblock]$GetLiveCounts) {
  try {
    $live = & $GetLiveCounts $Target
    $rows = @()
    foreach ($k in (@($MetaCounts.Keys) + @($live.Keys | Where-Object { -not $MetaCounts.Contains($_) }))) {
      $m = if ($MetaCounts.Contains($k)) { $MetaCounts[$k] } else { $null }
      $l = if ($live.Contains($k)) { $live[$k] } else { $null }
      $rows += [pscustomobject]@{ Table = $k; BackupMetadata = $m; CurrentLive = $l; Drift = $(if ($m -eq $l) { 'NO DRIFT' } else { 'DRIFT' }) }
    }
    $n = @($rows | Where-Object { $_.Drift -eq 'DRIFT' }).Count
    return [pscustomobject]@{ Status = $(if ($n) { 'DETECTED' } else { 'NONE' }); Reason = "$n of $($rows.Count) tables differ from the backup point"; Rows = $rows }
  } catch {
    return [pscustomobject]@{ Status = 'UNKNOWN'; Reason = "live counts unavailable: $($_.Exception.Message)"; Rows = @() }
  }
}

# The ONLY way a restore database becomes droppable by this run: THIS run's CREATE
# DATABASE exited 0. Ownership is recorded before the catalog confirmation (which can
# throw), so guarded cleanup still knows the database is ours. A failed CREATE never
# claims the name - even if a database with that name exists now - so it is never dropped.
# $Create returns the CREATE exit code; $CountInCatalog returns pg_database rows for the name.
function Invoke-OwnedCreate($State, $Target, [string]$Name, [scriptblock]$Create, [scriptblock]$CountInCatalog) {
  if ($State.CreatedRestoreDb) { throw 'run state already owns a restore database; refusing a second CREATE' }
  $code = & $Create $Target $Name
  if (-not ($code -is [int]) -or $code -ne 0) {
    $rows = 'unknown (catalog query failed)'
    try { $rows = "$(& $CountInCatalog $Target $Name)" } catch { }
    throw "CREATE DATABASE exited '$code'; '$Name' is NOT owned by this run and will not be dropped (pg_database rows for that name now: $rows)"
  }
  $State.CreatedRestoreDb = $Name
  $rows = "$(& $CountInCatalog $Target $Name)"
  if ($rows -ne '1') { throw "catalog does not confirm '$Name' after CREATE (rows: $rows); it stays run-owned for guarded cleanup" }
}

# ------------------------------------------------------------ backup destination --
function Get-CloudSyncRoots {
  $roots = New-Object System.Collections.ArrayList
  foreach ($v in @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial)) { if ($v) { [void]$roots.Add([pscustomobject]@{ Source = 'env OneDrive*'; Path = $v }) } }
  $srm = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager'
  if (Test-Path $srm) {
    foreach ($k in Get-ChildItem $srm) {
      $u = Join-Path $k.PSPath 'UserSyncRoots'
      if (Test-Path $u) {
        foreach ($prop in (Get-ItemProperty $u).PSObject.Properties) {
          if ($prop.Name -notlike 'PS*' -and $prop.Value) { [void]$roots.Add([pscustomobject]@{ Source = "Windows sync root ($($k.PSChildName.Split('!')[0]))"; Path = "$($prop.Value)" }) }
        }
      }
    }
  }
  $od = 'HKCU:\Software\Microsoft\OneDrive\Accounts'
  if (Test-Path $od) { foreach ($a in Get-ChildItem $od) { $p = Get-ItemProperty $a.PSPath; if ($p.PSObject.Properties['UserFolder'] -and $p.UserFolder) { [void]$roots.Add([pscustomobject]@{ Source = 'OneDrive account'; Path = $p.UserFolder }) } } }
  foreach ($f in @("$env:APPDATA\Dropbox\info.json", "$env:LOCALAPPDATA\Dropbox\info.json")) {
    if (Test-Path -LiteralPath $f) {
      $info = Get-Content -LiteralPath $f -Raw | ConvertFrom-Json
      foreach ($acct in $info.PSObject.Properties) { if ($acct.Value.PSObject.Properties['path']) { [void]$roots.Add([pscustomobject]@{ Source = 'Dropbox'; Path = $acct.Value.path }) } }
    }
  }
  $gd = 'HKCU:\Software\Google\DriveFS'
  if (Test-Path $gd) { $p = Get-ItemProperty $gd; if ($p.PSObject.Properties['MountPoint'] -and $p.MountPoint) { [void]$roots.Add([pscustomobject]@{ Source = 'Google Drive'; Path = $p.MountPoint }) } }
  $ic = Join-Path $env:USERPROFILE 'iCloudDrive'
  if (Test-Path -LiteralPath $ic) { [void]$roots.Add([pscustomobject]@{ Source = 'iCloud Drive'; Path = $ic }) }
  return $roots
}

function Test-PathUnder([string]$Child, [string]$Parent) {
  $c = [System.IO.Path]::GetFullPath($Child).TrimEnd('\') + '\'
  $p = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
  return $c.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-BackupDestination([string]$Root) {
  $dest = [System.IO.Path]::GetFullPath($Root)
  Write-Host "  repo root:   $RepoRoot"
  Write-Host "  destination: $dest"
  $insideRepo = (Test-PathUnder $dest $RepoRoot)
  Add-Check 'destination is outside the repository' (-not $insideRepo)
  if ($insideRepo) { Stop-Run 'backup destination is inside the repository' }

  # Not inside ANY Git work tree (so it cannot be Git-tracked).
  $probe = $dest; $gitDir = $null
  while ($probe) {
    if (Test-Path -LiteralPath (Join-Path $probe '.git')) { $gitDir = $probe; break }
    $parent = Split-Path $probe -Parent
    if ($parent -eq $probe) { break }
    $probe = $parent
  }
  Add-Check 'destination is not inside a Git work tree' ($null -eq $gitDir) $(if ($gitDir) { "work tree at $gitDir" } else { '' })
  if ($gitDir) { Stop-Run 'backup destination is inside a Git work tree' }

  # Cloud sync: OS-registered roots, known client config, name heuristics and placeholder attributes.
  $hits = New-Object System.Collections.ArrayList
  foreach ($r in Get-CloudSyncRoots) { if (Test-PathUnder $dest $r.Path) { [void]$hits.Add("$($r.Source): $($r.Path)") } }
  if ($dest -match '(?i)\\(OneDrive[^\\]*|Dropbox|Google Drive|My Drive|iCloud ?Drive)(\\|$)') { [void]$hits.Add("path name segment '$($Matches[1])'") }
  $existing = $dest
  while (-not (Test-Path -LiteralPath $existing)) { $existing = Split-Path $existing -Parent }
  $attr = [int](Get-Item -LiteralPath $existing -Force).Attributes
  $cloudAttrBits = 0x400 -bor 0x1000 -bor 0x40000 -bor 0x80000 -bor 0x100000 -bor 0x400000   # reparse, offline, recall-on-open, pinned, unpinned, recall-on-data-access
  if ($attr -band $cloudAttrBits) { [void]$hits.Add(("cloud/placeholder file attributes on '{0}' (0x{1:x})" -f $existing, $attr)) }
  $cloud = $hits.Count -gt 0
  Write-Host ("  cloud-sync evidence: {0}" -f $(if ($cloud) { $hits -join '; ' } else { 'none (checked env OneDrive*, Windows sync roots, OneDrive accounts, Dropbox, Google Drive, iCloud, path names, file attributes)' }))
  if ($cloud -and -not $AllowCloudSyncedDestination) {
    Add-Check 'destination is not cloud-synchronised' $false ($hits -join '; ')
    Stop-Run 'backup destination appears to be cloud-synchronised (use -AllowCloudSyncedDestination only by explicit decision)'
  }
  Add-Check 'destination is not cloud-synchronised' (-not $cloud) $(if ($cloud) { 'OVERRIDDEN by -AllowCloudSyncedDestination' } else { '' })
  return $dest
}

# ------------------------------------------------------------ container temp files --
function New-ContainerTempPath([string]$Kind) {
  return "/tmp/aic-$Kind-" + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.dump'
}

# Removes a container temp file and proves it is gone. Returns $true when gone.
function Remove-ContainerTemp($Target, [string]$Path) {
  if ($Path -notmatch '^/tmp/aic-[a-z]+-[0-9TZ]+-[0-9a-f]{8}\.dump$') { throw 'refusing to remove an unexpected container path' }
  [void](Invoke-Native 'docker' @('exec', $Target.Container, 'rm', '-f', $Path) -AllowFailure)
  $left = Invoke-Native 'docker' @('exec', $Target.Container, 'find', '/tmp', '-maxdepth', '1', '-name', (Split-Path $Path -Leaf)) -AllowFailure
  return ($left.ExitCode -eq 0 -and @($left.Lines | Where-Object { $_ -ne '' }).Count -eq 0)
}

function Get-ContainerFileSize($Target, [string]$Path) {
  $r = Invoke-Native 'docker' @('exec', $Target.Container, 'stat', '-c', '%s', $Path) -AllowFailure
  if ($r.ExitCode -ne 0 -or $r.Lines.Count -lt 1) { return -1 }
  return [long]$r.Lines[0]
}

# SHA256 of a file INSIDE the container - the bytes pg_restore will actually read.
# Fails closed: sha256sum missing (exit 126/127), any non-zero exit, or output whose
# first token is not 64 hex characters throws.
function Get-ContainerSha256($Target, [string]$Path) {
  $r = Invoke-Native 'docker' @('exec', $Target.Container, 'sha256sum', $Path) -AllowFailure
  if ($r.ExitCode -ne 0) { throw "sha256sum inside the container exited $($r.ExitCode)" }
  return ConvertFrom-Sha256SumOutput $r.Lines
}

# Parses `sha256sum FILE` output. BusyBox (the alpine image) and GNU coreutils both
# print "<64 hex>  <path>"; only the first token of the first line is used.
function ConvertFrom-Sha256SumOutput([string[]]$Lines = @()) {
  $first = if ($Lines.Count) { ("$($Lines[0])".Trim() -split '\s+')[0].ToLowerInvariant() } else { '' }
  if ($first -cnotmatch '^[0-9a-f]{64}$') { throw 'sha256sum output does not start with a 64-hex hash' }
  return $first
}

function Write-TextNoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# ------------------------------------------------------------ verify (shared) --
# Returns { Ok; Sha256; Size; Meta }. Ok only when every check passes, including that
# the .meta.json belongs to THIS dump - a dump plus a matching .sha256 is not enough.
# Copies the dump into the container only for `pg_restore --list`.
function Invoke-VerifyChecks($Target, [string]$Dump) {
  $result = [pscustomobject]@{ Ok = $false; Sha256 = $null; Size = [long]-1; Meta = $null }
  $exists = Test-Path -LiteralPath $Dump -PathType Leaf
  Add-Check 'dump exists' $exists $Dump
  if (-not $exists) { return $result }
  $size = (Get-Item -LiteralPath $Dump).Length
  Add-Check 'dump is non-empty' ($size -gt 0) "$size bytes"
  if ($size -le 0) { return $result }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Dump).Hash.ToLowerInvariant()
  $result.Sha256 = $actual; $result.Size = $size
  $sidecar = "$Dump.sha256"
  $hashOk = $false
  if (Test-Path -LiteralPath $sidecar) {
    $expected = ([System.IO.File]::ReadAllText($sidecar).Trim() -split '\s+')[0].ToLowerInvariant()
    $hashOk = ($expected -eq $actual -and $expected.Length -eq 64)
    Add-Check 'SHA256 matches .sha256 sidecar' $hashOk $actual
  } else { Add-Check 'SHA256 matches .sha256 sidecar' $false 'sidecar missing' }

  $metaPath = "$Dump.meta.json"
  $metaOk = $false
  if (Test-Path -LiteralPath $metaPath) {
    try {
      $meta = Get-Content -LiteralPath $metaPath -Raw | ConvertFrom-Json
      $problems = @(Test-BackupMetadata $meta (Split-Path $Dump -Leaf) $actual $size)
    } catch { $meta = $null; $problems = @("metadata unreadable: $($_.Exception.Message)") }
    $metaOk = ($problems.Count -eq 0)
    if ($metaOk) { $result.Meta = $meta }
    Add-Check '.meta.json belongs to this dump (sha256, file name, size)' $metaOk ($problems -join '; ')
  } else { Add-Check '.meta.json belongs to this dump (sha256, file name, size)' $false 'metadata sidecar missing' }

  $tmp = New-ContainerTempPath 'verify'
  $listOk = $false; $cleanOk = $false
  try {
    [void](Invoke-Native 'docker' @('cp', $Dump, "$($Target.Container):$tmp"))
    $list = Invoke-Native 'docker' @('exec', $Target.Container, 'pg_restore', '--list', $tmp) -AllowFailure
    $entries = @($list.Lines | Where-Object { $_ -and -not $_.StartsWith(';') }).Count
    $listOk = ($list.ExitCode -eq 0 -and $entries -gt 0)
    Add-Check 'pg_restore --list parses the dump' $listOk "$entries TOC entries (contents not printed)"
  } catch {
    Write-Host "  PRIMARY FAILURE (pg_restore --list step): $($_.Exception.Message)"
  } finally {
    try { $cleanOk = Remove-ContainerTemp $Target $tmp } catch { $cleanOk = $false; Write-Host "  CLEANUP FAILURE (container temp): $($_.Exception.Message)" }
    Add-Check 'verification temp copy removed from container' $cleanOk $tmp
  }
  $result.Ok = ($hashOk -and $metaOk -and $listOk -and $cleanOk)
  return $result
}

# ------------------------------------------------------------ drop (run-created only) --
# Takes NO target argument by design: the only database it can drop is the one
# recorded in run state by Invoke-RestoreTest's CREATE. Never uses FORCE.
function Remove-RunCreatedRestoreDb {
  $name = $script:RunState.CreatedRestoreDb
  if (-not $name) { Write-Host '  (no run-created restore database to drop)'; return $true }
  $t = $script:RunState.Target
  $guard = Test-RestoreTargetName -Name $name -LiveDbName $t.LiveDb -ExistingDatabases (Get-DatabaseNames $t) -Phase 'Drop' -RunCreatedName $script:RunState.CreatedRestoreDb -OperationMode $Mode -ServerVerified $t.Verified
  Add-Check 'destructive-name guard (drop phase) re-run independently' $guard.Ok $guard.Reason
  if (-not $guard.Ok) { return $false }
  $drop = Invoke-Native 'docker' @('exec', '-i', $t.Container, 'psql', '-X', '-q', '-U', $t.User, '-d', $MaintenanceDb, '-v', 'ON_ERROR_STOP=1', '-f', '-') -StdIn "DROP DATABASE $name;" -AllowFailure
  Add-Check 'DROP DATABASE (run-created only, via maintenance db, no FORCE)' ($drop.ExitCode -eq 0) $name
  $still = @(Invoke-Sql $t $MaintenanceDb "SELECT count(*) FROM pg_database WHERE datname = '$name';")[0]
  $gone = ($still -eq '0')
  Add-Check 'catalog proves the restore database no longer exists' $gone "pg_database rows for $name = $still"
  if ($gone) { $script:RunState.CreatedRestoreDb = $null }
  return $gone
}

# ================================================================== modes ==
function Invoke-SelfTest {
  Write-Step 'Guard and verdict self-test (no Docker, no database, no file writes)'
  $compose = Get-ComposeFacts
  $live = $compose.LiveDb
  $existingPrefixed = $RestorePrefix + '20260101t000000z'
  $catalog = @('postgres', 'template0', 'template1', $live, $existingPrefixed)
  $fresh = New-RestoreTestName
  $cases = @(
    @{ Case = 'empty name'; Name = ''; Phase = 'Create'; Expect = $false },
    @{ Case = 'exact live database name'; Name = $live; Phase = 'Create'; Expect = $false },
    @{ Case = 'postgres'; Name = 'postgres'; Phase = 'Create'; Expect = $false },
    @{ Case = 'template0'; Name = 'template0'; Phase = 'Create'; Expect = $false },
    @{ Case = 'template1'; Name = 'template1'; Phase = 'Create'; Expect = $false },
    @{ Case = 'name lacking restore-test prefix'; Name = 'aic_restore_test_20261002t000000z'; Phase = 'Create'; Expect = $false },
    @{ Case = 'malformed prefixed name (bad suffix)'; Name = $RestorePrefix + 'latest'; Phase = 'Create'; Expect = $false },
    @{ Case = 'malformed prefixed name (upper-case timestamp)'; Name = $RestorePrefix + '20261002T000000Z'; Phase = 'Create'; Expect = $false },
    @{ Case = 'correctly prefixed name that already exists'; Name = $existingPrefixed; Phase = 'Create'; Expect = $false },
    @{ Case = 'fresh valid prefixed name'; Name = $fresh; Phase = 'Create'; Expect = $true },
    @{ Case = 'valid name but not restore-test mode'; Name = $fresh; Phase = 'Create'; Expect = $false; OpMode = 'Backup' },
    @{ Case = 'valid name but server not verified'; Name = $fresh; Phase = 'Create'; Expect = $false; Server = $false },
    @{ Case = 'drop: name not created by this run'; Name = $existingPrefixed; Phase = 'Drop'; Expect = $false; RunCreated = $fresh },
    @{ Case = 'drop: live name recorded as run-created'; Name = $live; Phase = 'Drop'; Expect = $false; RunCreated = $live },
    @{ Case = 'drop: run-created name that exists'; Name = $existingPrefixed; Phase = 'Drop'; Expect = $true; RunCreated = $existingPrefixed }
  )
  $rows = @()
  foreach ($c in $cases) {
    $opMode = if ($c.ContainsKey('OpMode')) { $c.OpMode } else { 'RestoreTest' }
    $server = if ($c.ContainsKey('Server')) { $c.Server } else { $true }
    $runCreated = if ($c.ContainsKey('RunCreated')) { $c.RunCreated } else { $null }
    $r = Test-RestoreTargetName -Name $c.Name -LiveDbName $live -ExistingDatabases $catalog -Phase $c.Phase -RunCreatedName $runCreated -OperationMode $opMode -ServerVerified $server
    $rows += [pscustomobject]@{
      Case = $c.Case
      Expected = $(if ($c.Expect) { 'ACCEPT' } else { 'REFUSE' })
      Actual = $(if ($r.Ok) { 'ACCEPT' } else { 'REFUSE' })
      Result = $(if ($r.Ok -eq $c.Expect) { 'PASS' } else { 'FAIL' })
      Reason = $r.Reason
    }
  }
  # Structural checks: the drop path cannot be pointed at a caller-supplied name, and never uses FORCE.
  $dropParams = @((Get-Command Remove-RunCreatedRestoreDb).Parameters.Keys | Where-Object { $_ -notin [System.Management.Automation.PSCmdlet]::CommonParameters })
  $rows += [pscustomobject]@{ Case = 'drop function takes no target argument'; Expected = 'NONE'; Actual = $(if ($dropParams.Count) { $dropParams -join ',' } else { 'NONE' }); Result = $(if ($dropParams.Count -eq 0) { 'PASS' } else { 'FAIL' }); Reason = '' }
  $self = [System.IO.File]::ReadAllText($PSCommandPath)
  $forcePattern = 'WITH\s*\(\s*' + 'FORCE'
  $hasForce = $self -match $forcePattern
  $rows += [pscustomobject]@{ Case = 'script contains no forced DROP option'; Expected = 'ABSENT'; Actual = $(if ($hasForce) { 'PRESENT' } else { 'ABSENT' }); Result = $(if ($hasForce) { 'FAIL' } else { 'PASS' }); Reason = '' }

  function New-Row([string]$Case, [string]$Expected, [string]$Actual) {
    [pscustomobject]@{ Case = $Case; Expected = $Expected; Actual = $Actual; Result = $(if ($Expected -ceq $Actual) { 'PASS' } else { 'FAIL' }); Reason = '' }
  }
  $tk = $null; $er = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tk, [ref]$er)
  $enclosing = { param($n) $p = $n.Parent; while ($p -and $p -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $p = $p.Parent }; if ($p) { $p.Name } else { '<script>' } }
  $fn = { param($name) $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true) }

  # Ownership transition (F1): injected CREATE / catalog stand-ins and a private state table.
  $ownCases = @(
    @{ Case = 'own: CREATE exit 3, name absent'; Create = { 3 }; Count = { '0' }; Expect = 'NOT OWNED, FAIL' },
    @{ Case = 'own: CREATE exit 3, same name now exists (other creator)'; Create = { 3 }; Count = { '1' }; Expect = 'NOT OWNED, FAIL' },
    @{ Case = 'own: CREATE reports no exit code'; Create = { }; Count = { '1' }; Expect = 'NOT OWNED, FAIL' },
    @{ Case = 'own: CREATE exit 0, catalog confirms'; Create = { 0 }; Count = { '1' }; Expect = 'OWNED, OK' },
    @{ Case = 'own: CREATE exit 0, catalog query throws'; Create = { 0 }; Count = { throw 'catalog unavailable' }; Expect = 'OWNED, FAIL' },
    @{ Case = 'own: CREATE exit 0, catalog shows no row'; Create = { 0 }; Count = { '0' }; Expect = 'OWNED, FAIL' }
  )
  foreach ($c in $ownCases) {
    $st = @{ CreatedRestoreDb = $null }; $failed = $false
    try { Invoke-OwnedCreate $st $null $fresh $c.Create $c.Count } catch { $failed = $true }
    $own = if ($st.CreatedRestoreDb -ceq $fresh) { 'OWNED' } elseif ($null -eq $st.CreatedRestoreDb) { 'NOT OWNED' } else { 'OTHER' }
    $rows += New-Row $c.Case $c.Expect ('{0}, {1}' -f $own, $(if ($failed) { 'FAIL' } else { 'OK' }))
  }
  $st = @{ CreatedRestoreDb = $existingPrefixed }; $msg = ''
  try { Invoke-OwnedCreate $st $null $fresh { 0 } { '1' } } catch { $msg = $_.Exception.Message }
  $rows += New-Row 'own: second CREATE while already owning one' 'refused, unchanged' ('{0}, {1}' -f $(if ($msg -like 'run state already owns*') { 'refused' } else { 'accepted' }), $(if ($st.CreatedRestoreDb -ceq $existingPrefixed) { 'unchanged' } else { 'changed' }))
  $rows += New-Row 'own: SelfTest left the real run state empty' 'EMPTY' $(if ($null -eq $script:RunState.CreatedRestoreDb) { 'EMPTY' } else { 'SET' })
  $setters = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -match 'CreatedRestoreDb' }, $true) |
      Where-Object { (& $enclosing $_) -ne 'Invoke-OwnedCreate' -and $_.Right.Extent.Text -ne '$null' })
  $rows += New-Row 'own: non-null ownership assigned only in Invoke-OwnedCreate' 'NONE ELSEWHERE' $(if ($setters.Count) { ($setters | ForEach-Object { "L$($_.Extent.StartLineNumber)" }) -join ',' } else { 'NONE ELSEWHERE' })

  # Live-database write audit: Invoke-Sql cannot be told to write; the only other psql calls are CREATE/DROP via "postgres".
  $sqlParams = @((Get-Command Invoke-Sql).Parameters.Keys | Where-Object { $_ -notin [System.Management.Automation.PSCmdlet]::CommonParameters }) -join ','
  $rows += New-Row 'sql: Invoke-Sql has no switch to leave read-only mode' 'Target,Database,Sql' $sqlParams
  $writers = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-Native' -and $n.Extent.Text -match "'psql'" }, $true) |
      Where-Object { (& $enclosing $_) -ne 'Invoke-Sql' })
  $okWriters = @($writers | Where-Object { $_.Extent.Text -match "'-d', \`$MaintenanceDb" -and $_.Extent.Text -match '-StdIn "(CREATE|DROP) DATABASE \$' })
  $rows += New-Row 'sql: psql outside Invoke-Sql = CREATE/DROP via postgres only' '2 of 2' ('{0} of {1}' -f $okWriters.Count, $writers.Count)

  # Restore ledger semantics (F3): restored vs metadata is exact; repo comparison is informational.
  $rows += New-Row 'ledger: restored == backup metadata (count + order)' 'True' ([string](Test-SameOrdered @('h1', 'h2') @('h1', 'h2')))
  $rows += New-Row 'ledger: restored order differs from metadata' 'False' ([string](Test-SameOrdered @('h2', 'h1') @('h1', 'h2')))
  $rows += New-Row 'ledger: restored lacks a metadata row' 'False' ([string](Test-SameOrdered @('h1') @('h1', 'h2')))
  $repoIds = @('101', '102', '103')
  foreach ($lc in @(
      @{ Case = 'repo: backup ledger == repo ledger'; B = @('101', '102', '103'); Expect = 'OK: backup ledger equals the repo ledger' },
      @{ Case = 'repo: backup is an ordered prefix of repo'; B = @('101', '102'); Expect = 'OK: backup is 1 migrations behind the repo' },
      @{ Case = 'repo: divergence inside the common prefix'; B = @('101', '999', '103'); Expect = 'FAIL: backup and repo ledgers diverge at migration #2' },
      @{ Case = 'repo: backup newer than repo'; B = @('101', '102', '103', '104'); Expect = 'OK: repo is 1 migrations behind the backup' })) {
    $r = Compare-LedgerToRepo $lc.B $repoIds
    $rows += New-Row $lc.Case $lc.Expect ('{0}: {1}' -f $(if ($r.Ok) { 'OK' } else { 'FAIL' }), $r.Text)
  }
  $ids = @(Get-RepoMigrationIds)
  $rows += New-Row 'repo: identities are journal "when" values (not file bytes)' 'NUMERIC' $(if ($ids.Count -gt 0 -and @($ids | Where-Object { $_ -notmatch '^\d+$' }).Count -eq 0) { 'NUMERIC' } else { 'OTHER' })

  # Live drift (F3): separate report; unavailable -> UNKNOWN, never thrown into the restore verdict.
  $mc = [ordered]@{ 'public.a' = [long]2; 'public.b' = [long]5 }
  $rows += New-Row 'drift: live available, identical' 'NONE' (Get-DriftReport $mc $null { [ordered]@{ 'public.a' = [long]2; 'public.b' = [long]5 } }).Status
  $rows += New-Row 'drift: live available, one table changed' 'DETECTED' (Get-DriftReport $mc $null { [ordered]@{ 'public.a' = [long]3; 'public.b' = [long]5 } }).Status
  $rows += New-Row 'drift: live unavailable (query throws)' 'UNKNOWN' (Get-DriftReport $mc $null { throw 'live database unreadable' }).Status
  $rt = & $fn 'Invoke-RestoreTest'
  $verdict = @($rt.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$restorePass' -and $n.Right.Extent.Text -match 'tableFails' }, $true))
  $driftCall = @($rt.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Get-DriftReport' }, $true))
  $verdictFirst = ($verdict.Count -eq 1 -and $driftCall.Count -eq 1 -and $verdict[0].Extent.StartLineNumber -lt $driftCall[0].Extent.StartLineNumber)
  $rows += New-Row 'drift: restore verdict is fixed before the (non-throwing) drift report' 'True' ([string]$verdictFirst)

  # Metadata binding (F4).
  $sha = 'a' * 64
  $good = [pscustomobject]@{ managedBy = $ManagedBy; formatVersion = 1; dumpFile = 'x.dump'; sha256 = $sha; dumpSizeBytes = 10; rowCounts = [pscustomobject]@{}; migrationLedgerHashes = @() }
  foreach ($v in @(
      @{ Case = 'meta: belongs to the dump'; Expect = 'ACCEPT' },
      @{ Case = 'meta: sha256 of another dump'; Field = 'sha256'; Value = ('b' * 64); Expect = 'REFUSE' },
      @{ Case = 'meta: other dump file name'; Field = 'dumpFile'; Value = 'y.dump'; Expect = 'REFUSE' },
      @{ Case = 'meta: other dump size'; Field = 'dumpSizeBytes'; Value = 11; Expect = 'REFUSE' },
      @{ Case = 'meta: not written by this script'; Field = 'managedBy'; Value = 'manual'; Expect = 'REFUSE' },
      @{ Case = 'meta: sha256 field missing'; Remove = 'sha256'; Expect = 'REFUSE' })) {
    $m = $good.PSObject.Copy()
    if ($v.ContainsKey('Field')) { $m.($v.Field) = $v.Value }
    if ($v.ContainsKey('Remove')) { $m.PSObject.Properties.Remove($v.Remove) }
    $rows += New-Row $v.Case $v.Expect $(if (@(Test-BackupMetadata $m 'x.dump' $sha 10).Count) { 'REFUSE' } else { 'ACCEPT' })
  }

  # Container-side hash (F4): sha256sum output parsing fails closed; the check precedes pg_restore.
  $h64 = 'ab' * 32
  foreach ($pc in @(
      @{ Case = 'hash: busybox/GNU "<hash>  <path>"'; Lines = @("$h64  /tmp/aic-restore-x.dump"); Expect = $h64 },
      @{ Case = 'hash: upper-case hex is lower-cased'; Lines = @("$($h64.ToUpperInvariant())  /tmp/x"); Expect = $h64 },
      @{ Case = 'hash: 63 hex characters'; Lines = @("$($h64.Substring(1))  /tmp/x"); Expect = 'REFUSED' },
      @{ Case = 'hash: non-hex first token'; Lines = @('sha256sum: /tmp/x: No such file or directory'); Expect = 'REFUSED' },
      @{ Case = 'hash: no output'; Lines = @(); Expect = 'REFUSED' })) {
    $got = 'REFUSED'
    try { $got = ConvertFrom-Sha256SumOutput $pc.Lines } catch { }
    $rows += New-Row $pc.Case $pc.Expect $got
  }
  $hashCall = @($rt.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Get-ContainerSha256' }, $true))
  $restoreCall = @($rt.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-Native' -and $n.Extent.Text -match "'pg_restore', '-U'" }, $true))
  $rows += New-Row 'hash: container-hash check precedes pg_restore in Invoke-RestoreTest' 'True' ([string]($hashCall.Count -eq 1 -and $restoreCall.Count -eq 1 -and $hashCall[0].Extent.StartLineNumber -lt $restoreCall[0].Extent.StartLineNumber))

  # Publication order (F2): Git facts before pg_dump; sidecars written and validated before any rename; the .dump renamed last.
  $bk = & $fn 'Invoke-Backup'
  $line = { param($name, $match) @($bk.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq $name -and $n.Extent.Text -match $match }, $true) | ForEach-Object { $_.Extent.StartLineNumber }) }
  $git = @(& $line 'Invoke-Native' "'git'"); $dump = @(& $line 'Invoke-Native' "'pg_dump'")
  $writes = @(& $line 'Write-TextNoBom' '.') + @(& $line 'Test-BackupMetadata' '.'); $moves = @(& $line 'Move-Item' '.')
  $lastMove = @($bk.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Move-Item' }, $true))[-1].Extent.Text
  $order = ($git.Count -eq 2 -and $dump.Count -eq 1 -and ($git | Measure-Object -Maximum).Maximum -lt $dump[0] -and
    ($writes | Measure-Object -Maximum).Maximum -lt ($moves | Measure-Object -Minimum).Minimum -and $lastMove -match '\$partial\.Dump')
  $rows += New-Row 'publish: git < pg_dump; sidecars validated < renames; .dump renamed last' 'True' ([string]$order)

  $rows | Format-Table -AutoSize | Out-String -Width 300 | Write-Host
  $failed = @($rows | Where-Object { $_.Result -ne 'PASS' }).Count
  Write-Host ("SELF-TEST: {0} of {1} cases PASS" -f ($rows.Count - $failed), $rows.Count)
  return ($failed -eq 0)
}

function Invoke-Backup {
  Write-Step 'Backup: identify the live database'
  $t = Get-DbTarget
  Write-Host "  container: $($t.Container) (service $($t.Service), image $($t.Image))"
  Write-Host "  PostgreSQL $($t.Version); live database: $($t.LiveDb)"

  Write-Step 'Backup: destination'
  $dest = Assert-BackupDestination $BackupRoot
  if (-not (Test-Path -LiteralPath $dest)) { [void](New-Item -ItemType Directory -Path $dest) }

  Write-Step 'Backup: Git facts (collected before the dump, so a Git failure cannot strand one)'
  $gitHead = (Invoke-Native 'git' @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Lines[0]
  $gitClean = (@((Invoke-Native 'git' @('-C', $RepoRoot, 'status', '--porcelain')).Lines | Where-Object { $_ -ne '' }).Count -eq 0)
  Write-Host "  HEAD $gitHead; working tree clean: $gitClean"

  Write-Step 'Backup: active-session gate'
  Assert-NoOtherSessions $t

  Write-Step 'Backup: row-count snapshot (before dump)'
  $before = Get-TableCounts $t $t.LiveDb
  $ledger = @(Get-Ledger $t $t.LiveDb | ForEach-Object { $_.Hash })
  Write-Host "  user tables: $($before.Count); migration ledger rows: $($ledger.Count)"

  $stamp = (Get-Date).ToUniversalTime()
  $baseName = '{0}_{1}_pg{2}' -f $t.LiveDb, $stamp.ToString('yyyyMMddTHHmmssZ'), $t.Major
  $dumpName = "$baseName.dump"
  $finalDump = Join-Path $dest $dumpName
  # Publication contract: everything is written under .partial names and validated; the
  # .dump is renamed to its final name LAST. A final .dump therefore means the complete,
  # validated set exists. Every path below is proven absent now, so any of them found
  # later was created by this run and is the only thing failure cleanup may remove.
  $final = [ordered]@{ Sha = "$finalDump.sha256"; Meta = "$finalDump.meta.json"; Dump = $finalDump }
  $partial = [ordered]@{ Sha = "$finalDump.sha256.partial"; Meta = "$finalDump.meta.json.partial"; Dump = "$finalDump.partial" }
  $runOwned = @($final.Values) + @($partial.Values)
  foreach ($p in $runOwned) { if (Test-Path -LiteralPath $p) { Stop-Run "refusing to overwrite existing file $p" } }

  $tmp = New-ContainerTempPath 'backup'
  $ok = $false; $published = $false; $tmpGone = $false
  try {
    Write-Step 'Backup: pg_dump -Fc inside the container'
    $dump = Invoke-Native 'docker' @('exec', $t.Container, 'pg_dump', '-U', $t.User, '-d', $t.LiveDb, '-Fc', '-f', $tmp) -AllowFailure
    Add-Check 'pg_dump exited 0' ($dump.ExitCode -eq 0) "exit $($dump.ExitCode)"
    if ($dump.ExitCode -ne 0) { throw 'pg_dump failed' }
    $containerSize = Get-ContainerFileSize $t $tmp
    Add-Check 'container dump exists and is non-empty' ($containerSize -gt 0) "$containerSize bytes"
    if ($containerSize -le 0) { throw 'container dump missing or empty' }

    Write-Step 'Backup: docker cp to host (binary copy, no PowerShell text handling)'
    $cp = Invoke-Native 'docker' @('cp', "$($t.Container):$tmp", $partial.Dump) -AllowFailure
    Add-Check 'docker cp exited 0' ($cp.ExitCode -eq 0) "exit $($cp.ExitCode)"
    if ($cp.ExitCode -ne 0) { throw 'docker cp failed' }
    $hostSize = if (Test-Path -LiteralPath $partial.Dump) { (Get-Item -LiteralPath $partial.Dump).Length } else { -1 }
    Add-Check 'host copy size equals container dump size' ($hostSize -eq $containerSize) "$hostSize bytes"
    if ($hostSize -ne $containerSize) { throw 'host copy size mismatch' }

    Write-Step 'Backup: row-count snapshot (after dump) - consistency check'
    $after = Get-TableCounts $t $t.LiveDb
    $same = ($before.Count -eq $after.Count)
    foreach ($k in $before.Keys) { if (-not $after.Contains($k) -or $after[$k] -ne $before[$k]) { $same = $false } }
    Add-Check 'row counts identical before and after pg_dump' $same
    if (-not $same) { throw 'live row counts changed during the dump; the snapshot is not a stable comparison point' }

    Write-Step 'Backup: checksum and metadata (written under .partial names, not yet published)'
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $partial.Dump).Hash.ToLowerInvariant()
    Write-TextNoBom $partial.Sha "$hash  $dumpName`n"
    $meta = [ordered]@{
      managedBy = $ManagedBy
      formatVersion = 1
      createdAtUtc = $stamp.ToString('yyyy-MM-ddTHH:mm:ssZ')
      gitHead = $gitHead
      gitWorkingTreeClean = $gitClean
      postgresVersion = $t.Version
      postgresMajor = $t.Major
      container = $t.Container
      database = $t.LiveDb
      dumpFile = $dumpName
      dumpFormat = 'pg_dump -Fc (custom format)'
      dumpSizeBytes = $hostSize
      sha256 = $hash
      migrationLedgerCount = $ledger.Count
      migrationLedgerHashes = $ledger
      tableCount = $before.Count
      rowCountCapture = 'exact count(*) per user table, read-only, captured immediately before and after pg_dump with no other sessions connected; identical'
      rowCounts = $before
    }
    Write-TextNoBom $partial.Meta ($meta | ConvertTo-Json -Depth 5)

    Write-Step 'Backup: validate the unpublished set (re-read from disk)'
    $recheck = (Get-FileHash -Algorithm SHA256 -LiteralPath $partial.Dump).Hash.ToLowerInvariant()
    $shaLine = [System.IO.File]::ReadAllText($partial.Sha).Trim() -split '\s+'
    $shaOk = ($recheck -ceq $hash -and $shaLine.Count -eq 2 -and $shaLine[0] -ceq $hash -and $shaLine[1] -ceq $dumpName)
    Add-Check 'dump SHA256 re-read equals the .sha256 sidecar' $shaOk $hash
    $metaProblems = @(Test-BackupMetadata (Get-Content -LiteralPath $partial.Meta -Raw | ConvertFrom-Json) $dumpName $hash $hostSize)
    Add-Check '.meta.json re-read belongs to this dump (sha256, file name, size)' ($metaProblems.Count -eq 0) ($metaProblems -join '; ')
    if (-not $shaOk -or $metaProblems.Count) { throw 'unpublished backup set failed validation' }

    Write-Step 'Backup: publish (sidecars first, the .dump LAST)'
    Move-Item -LiteralPath $partial.Sha -Destination $final.Sha
    Move-Item -LiteralPath $partial.Meta -Destination $final.Meta
    Move-Item -LiteralPath $partial.Dump -Destination $final.Dump
    $published = $true
    $ok = $true
  } catch {
    Write-Host "  PRIMARY FAILURE: $($_.Exception.Message)"
  } finally {
    try { $tmpGone = Remove-ContainerTemp $t $tmp } catch { $tmpGone = $false; Write-Host "  CLEANUP FAILURE (container temp): $($_.Exception.Message)" }
    Add-Check 'container temporary dump removed (contains real financial data)' $tmpGone $tmp
    if (-not $published) {
      foreach ($p in $runOwned) {
        if (Test-Path -LiteralPath $p) {
          try { Remove-Item -LiteralPath $p; Write-Host "  removed unpublished run-owned file $p (never a valid backup)" }
          catch { Write-Host "  CLEANUP FAILURE: could not remove unpublished run-owned file $p : $($_.Exception.Message)" }
        }
      }
    }
  }
  if ($published -and -not $tmpGone) { Write-Host "  the backup set is published and complete, but the container still holds the temp copy $tmp" }
  if (-not $tmpGone) { $ok = $false }
  if ($ok) {
    Write-Host ''
    Write-Host "BACKUP OK: $finalDump"
    Write-Host "  size $hostSize bytes; sha256 $hash; PostgreSQL $($t.Version); ledger $($ledger.Count); tables $($before.Count)"
  }
  return $ok
}

function Invoke-Verify {
  if (-not $DumpPath) { Stop-Run '-DumpPath is required for Verify' }
  Write-Step 'Verify: identify the local server (for pg_restore --list)'
  $t = Get-DbTarget
  Write-Step "Verify: $DumpPath"
  return (Invoke-VerifyChecks $t ([System.IO.Path]::GetFullPath($DumpPath))).Ok
}

function Invoke-RestoreTest {
  if (-not $DumpPath) { Stop-Run '-DumpPath is required for RestoreTest' }
  $dump = [System.IO.Path]::GetFullPath($DumpPath)

  Write-Step 'RestoreTest: identify the live database'
  $t = Get-DbTarget
  $script:RunState.Target = $t
  Write-Host "  container: $($t.Container); PostgreSQL $($t.Version); live database: $($t.LiveDb)"

  Write-Step 'RestoreTest: active-session gate'
  Assert-NoOtherSessions $t

  Write-Step 'RestoreTest: verify the dump before restoring'
  $verified = Invoke-VerifyChecks $t $dump
  if (-not $verified.Ok) { Stop-Run 'dump verification failed (including metadata binding); nothing was restored' }
  $meta = $verified.Meta
  $metaCounts = [ordered]@{}
  foreach ($p in $meta.rowCounts.PSObject.Properties) { $metaCounts[$p.Name] = [long]$p.Value }
  Write-Host "  backup metadata: $($metaCounts.Count) tables, ledger $($meta.migrationLedgerCount), taken $($meta.createdAtUtc)"

  Write-Step 'RestoreTest: destructive-name guard (create phase)'
  $name = New-RestoreTestName
  $existing = Get-DatabaseNames $t
  $guard = Test-RestoreTargetName -Name $name -LiveDbName $t.LiveDb -ExistingDatabases $existing -Phase 'Create' -RunCreatedName $null -OperationMode $Mode -ServerVerified $t.Verified
  Add-Check 'destructive-name guard (create phase)' $guard.Ok "$name - $($guard.Reason)"
  if (-not $guard.Ok) { Stop-Run 'restore target refused by guard' }

  $tmp = New-ContainerTempPath 'restore'
  $restorePass = $false; $dropOk = $false; $tmpGone = $false; $drift = $null
  $tableRows = @()
  $createDb = { param($T, $N) (Invoke-Native 'docker' @('exec', '-i', $T.Container, 'psql', '-X', '-q', '-U', $T.User, '-d', $MaintenanceDb, '-v', 'ON_ERROR_STOP=1', '-f', '-') -StdIn "CREATE DATABASE $N;" -AllowFailure).ExitCode }
  $countDb = { param($T, $N) @(Invoke-Sql $T $MaintenanceDb "SELECT count(*) FROM pg_database WHERE datname = '$N';")[0] }
  try {
    Write-Step "RestoreTest: CREATE DATABASE $name (via maintenance db '$MaintenanceDb')"
    try { Invoke-OwnedCreate $script:RunState $t $name $createDb $countDb }
    catch { Add-Check 'CREATE DATABASE exited 0 (run-owned) and catalog confirms it' $false $_.Exception.Message; throw }
    Add-Check 'CREATE DATABASE exited 0 (run-owned) and catalog confirms it' $true $name

    Write-Step 'RestoreTest: copy dump into container and pg_restore there'
    [void](Invoke-Native 'docker' @('cp', $dump, "$($t.Container):$tmp"))
    # The bytes restored must be the bytes verified: container copy size and the host file's
    # SHA256 taken AFTER the copy must both still equal the verified values, and the
    # container copy itself (the file pg_restore reads) must hash to the verified SHA256.
    $copySize = Get-ContainerFileSize $t $tmp
    $hashAfterCopy = (Get-FileHash -Algorithm SHA256 -LiteralPath $dump).Hash.ToLowerInvariant()
    $sameBytes = ($copySize -eq $verified.Size -and $hashAfterCopy -ceq $verified.Sha256)
    Add-Check 'restore copy equals the verified dump (container size, host SHA256 after copy)' $sameBytes "$copySize bytes"
    if (-not $sameBytes) { throw 'dump changed between verification and the restore copy' }
    try { $containerHash = Get-ContainerSha256 $t $tmp }
    catch { Add-Check 'container copy SHA256 (the file pg_restore reads) equals the verified SHA256' $false $_.Exception.Message; throw }
    $containerSame = ($containerHash -ceq $verified.Sha256)
    Add-Check 'container copy SHA256 (the file pg_restore reads) equals the verified SHA256' $containerSame $containerHash
    if (-not $containerSame) { throw 'container copy differs from the verified dump; pg_restore not run' }
    $restore = Invoke-Native 'docker' @('exec', $t.Container, 'pg_restore', '-U', $t.User, '-d', $name, '--exit-on-error', '--no-owner', $tmp) -AllowFailure
    Add-Check 'pg_restore exited 0' ($restore.ExitCode -eq 0) "exit $($restore.ExitCode)"
    if ($restore.ExitCode -ne 0) { throw 'pg_restore failed' }

    Write-Step 'RestoreTest: restored row counts vs BACKUP METADATA (primary verdict)'
    $restored = Get-TableCounts $t $name
    $allKeys = @($metaCounts.Keys) + @($restored.Keys | Where-Object { -not $metaCounts.Contains($_) })
    foreach ($k in $allKeys) {
      $m = if ($metaCounts.Contains($k)) { $metaCounts[$k] } else { $null }
      $r = if ($restored.Contains($k)) { $restored[$k] } else { $null }
      $status = if ($null -eq $r) { 'FAIL (missing table)' } elseif ($null -eq $m) { 'FAIL (extra table)' } elseif ($m -eq $r) { 'PASS' } else { 'FAIL (count mismatch)' }
      $tableRows += [pscustomobject]@{ Table = $k; BackupMetadata = $m; Restored = $r; Result = $status }
    }
    $tableRows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
    $tableFails = @($tableRows | Where-Object { $_.Result -ne 'PASS' })
    Add-Check 'every table: restored count equals backup-metadata count' ($tableFails.Count -eq 0) ("{0} tables, {1} missing, {2} extra, {3} mismatched" -f $tableRows.Count, @($tableFails | Where-Object { $_.Result -like '*missing*' }).Count, @($tableFails | Where-Object { $_.Result -like '*extra*' }).Count, @($tableFails | Where-Object { $_.Result -like '*mismatch*' }).Count)

    Write-Step 'RestoreTest: migration ledger (authoritative: restored vs backup metadata)'
    $restoredLedger = @(Get-Ledger $t $name)
    $ledgerVsMeta = Test-SameOrdered @($restoredLedger | ForEach-Object { $_.Hash }) @($meta.migrationLedgerHashes)
    Add-Check 'restored ledger equals backup-metadata ledger (count and ordered hashes)' $ledgerVsMeta "$($restoredLedger.Count) rows"
    $repo = Compare-LedgerToRepo @($restoredLedger | ForEach-Object { $_.CreatedAt }) @(Get-RepoMigrationIds)
    Add-Check 'backup ledger vs repository journal (informational; only a divergence fails)' $repo.Ok $repo.Text

    $restorePass = ($tableFails.Count -eq 0 -and $ledgerVsMeta -and $repo.Ok)

    Write-Step 'RestoreTest: current LIVE counts vs backup metadata (drift report, never part of the restore verdict)'
    $drift = Get-DriftReport $metaCounts $t { param($T) Get-TableCounts $T $T.LiveDb }
    if ($drift.Rows.Count) { $drift.Rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host }
    Write-Host ("  DRIFT: {0} - {1}" -f $drift.Status, $drift.Reason)
  } catch {
    Write-Host "  PRIMARY FAILURE: $($_.Exception.Message)"
    $restorePass = $false
  } finally {
    Write-Step 'RestoreTest: cleanup'
    try { $tmpGone = Remove-ContainerTemp $t $tmp } catch { $tmpGone = $false; Write-Host "  CLEANUP FAILURE (container temp): $($_.Exception.Message)" }
    Add-Check 'container temporary dump removed (contains real financial data)' $tmpGone $tmp
    try { $dropOk = Remove-RunCreatedRestoreDb } catch { $dropOk = $false; Write-Host "  CLEANUP FAILURE (restore database): $($_.Exception.Message)" }
    if (-not $dropOk) { Write-Host '  *** CLEANUP FAILED: the throwaway restore database may still exist. No broader cleanup was attempted. ***' }
  }
  Write-Host ''
  Write-Host ("RESTORE TEST (restored vs backup metadata): {0}" -f $(if ($restorePass) { 'PASS' } else { 'FAIL' }))
  Write-Host ("LIVE DRIFT (separate report): {0}" -f $(if ($drift) { $drift.Status } else { 'NOT RUN' }))
  Write-Host ("CLEANUP: {0}" -f $(if ($dropOk -and $tmpGone) { 'PASS' } else { 'FAIL' }))
  return ($restorePass -and $dropOk -and $tmpGone)
}

# ================================================================== main ==
$result = $false
try {
  switch ($Mode) {
    'SelfTest' { $result = Invoke-SelfTest }
    'Backup' { $result = Invoke-Backup }
    'Verify' { $result = Invoke-Verify }
    'RestoreTest' { $result = Invoke-RestoreTest }
  }
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)"
  if ($Mode -eq 'RestoreTest' -and $script:RunState.CreatedRestoreDb) {
    Write-Host '  attempting cleanup of the run-created restore database only'
    $retryOk = $false
    try { $retryOk = Remove-RunCreatedRestoreDb } catch { Write-Host "  CLEANUP FAILURE (restore database): $($_.Exception.Message)" }
    if (-not $retryOk) { Write-Host '  *** CLEANUP FAILED: the throwaway restore database may still exist. No broader cleanup was attempted. ***' }
  }
  $result = $false
}
Write-Host ''
Write-Host ("{0}: {1}" -f $Mode.ToUpperInvariant(), $(if ($result) { 'PASS' } else { 'FAIL' }))
if ($result) { exit 0 } else { exit 1 }
