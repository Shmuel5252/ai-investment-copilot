<#
.SYNOPSIS
  Scheduled database backup with an ENCRYPTED off-machine copy and local
  retention (Production Readiness Unit 5). A thin orchestrator around
  scripts/db-backup.ps1 (Unit 2A), which it calls unchanged.

.DESCRIPTION
  Modes:
    SetupPassphrase  Run by the Owner only, interactively. Reads the archive
                     passphrase twice (hidden), requires a match, 20+ printable
                     ASCII characters, and stores it DPAPI-protected for the
                     current Windows user. Prints only "stored".
    Run              What the scheduled task calls:
                       1. db-backup.ps1 Backup, then Verify on the new set. Any
                          FAIL (including the active-session gate) ends the run.
                       2. Weekly (Sunday, or -WithRestoreTest): RestoreTest.
                       3. tar the set (dump + .sha256 + .meta.json) in a
                          non-cloud temp folder, encrypt with GnuPG symmetric
                          AES256 (passphrase on stdin only), write
                          <set>.tar.gpg.partial to the archive folder, rename.
                       4. Decrypt the archive in a non-cloud temp folder, untar,
                          and prove all three files are byte-identical to the
                          local set. All temp plaintext is deleted in finally.
                       5. Local retention: keep the newest N complete sets
                          (default 30); delete only exact managed names.
                          -DryRun lists instead of deleting. The archive folder
                          and the historical backup folder are never pruned.
    SelfTest         Pure checks: no Docker, no database, no file writes.

  Passphrase rules: never on a command line, in output, in a log, or in any file
  other than the DPAPI store. GnuPG reads it from stdin (--passphrase-fd 0).
  -PassphraseSource Stdin exists for dry runs: the first stdin line is the
  passphrase, and the archive folder must then NOT be cloud-synced.

  Recovery does not depend on this script: any GnuPG decrypts the .tar.gpg with
  the passphrase from the password manager (docs/runbook-db-backup.md).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode SelfTest
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode SetupPassphrase
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode Run
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode Run -WithRestoreTest -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('SetupPassphrase', 'Run', 'SelfTest')]
  [string]$Mode,

  # Run: also do the weekly RestoreTest now (otherwise only on Sunday).
  [switch]$WithRestoreTest,

  # Run: retention lists what it would delete and deletes nothing.
  [switch]$DryRun,

  # SetupPassphrase: replace an already stored passphrase.
  [switch]$ReplaceExisting,

  # Dpapi (default, production) or Stdin (dry runs with a throwaway passphrase).
  [ValidateSet('Dpapi', 'Stdin')]
  [string]$PassphraseSource = 'Dpapi',

  # The Unit 2A backup root (db-backup.ps1's default).
  [string]$BackupRoot = 'C:\dev-private\backups',

  # Where the encrypted archives go. Default: OneDrive\ai-investment-copilot-backups.
  [string]$ArchiveDir,

  # Plaintext scratch space. Must be outside the repo and not cloud-synced.
  [string]$TempRoot = 'C:\dev-private\backup-tmp',

  # Run logs (no secrets, no row data). Default: <BackupRoot>\logs.
  [string]$LogDir,

  [string]$PassphraseFile = 'C:\dev-private\backup-secrets\passphrase.dpapi',

  [ValidateRange(1, 3650)]
  [int]$KeepSets = 30,

  [string]$GpgPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- constants --
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$DbBackupScript = Join-Path $PSScriptRoot 'db-backup.ps1'
$HistoricalDir = 'C:\dev-private\ai-investment-copilot-backups'
$SetBasePattern = 'ai_investment_copilot_\d{8}T\d{6}Z_pg\d+'
$ManagedFileRegex = '^(' + $SetBasePattern + ')\.dump(\.sha256|\.meta\.json)?$'
$RunDirRegex = '^run-[0-9a-f]{32}$'
$MinPassphraseLength = 20
$StaleRunDirHours = 12
if (-not $ArchiveDir) { $ArchiveDir = if ($env:OneDrive) { Join-Path $env:OneDrive 'ai-investment-copilot-backups' } else { '' } }
if (-not $LogDir) { $LogDir = Join-Path $BackupRoot 'logs' }

# Unit 2A's own cloud-sync detection is reused, not copied: the two functions are
# lifted out of db-backup.ps1 by AST (db-backup.ps1 is parsed, never executed).
$dbTokens = $null; $dbErrors = $null
$dbAst = [System.Management.Automation.Language.Parser]::ParseFile($DbBackupScript, [ref]$dbTokens, [ref]$dbErrors)
foreach ($fnName in @('Get-CloudSyncRoots', 'Test-PathUnder')) {
  $def = $dbAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $fnName }, $true)
  if (-not $def) { throw "could not find $fnName in db-backup.ps1" }
  . ([scriptblock]::Create($def.Extent.Text))
}

# ------------------------------------------------------------------ logging --
$script:LogFile = $null
function Write-Log([string]$Text, [string]$Level = 'INFO') {
  $line = '[{0}] {1,-5} {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Text
  Write-Host $line
  if ($script:LogFile) {
    try { [System.IO.File]::AppendAllText($script:LogFile, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false))) } catch { }
  }
}

# ------------------------------------------------------------ pure helpers (exercised by SelfTest) --
function Test-IsWeeklyDay([datetime]$Date) { return ($Date.DayOfWeek -eq [System.DayOfWeek]::Sunday) }

# Reasons a passphrase is not acceptable (no output = acceptable).
function Test-PassphraseAcceptable([string]$Plain) {
  $problems = @()
  if ([string]::IsNullOrEmpty($Plain) -or $Plain.Length -lt $MinPassphraseLength) { $problems += "shorter than $MinPassphraseLength characters" }
  if (-not [string]::IsNullOrEmpty($Plain)) {
    if ($Plain -cmatch '[^\x20-\x7E]') { $problems += 'has characters outside printable ASCII (kept ASCII so it is typed identically on any machine)' }
    if ($Plain -ne $Plain.Trim()) { $problems += 'starts or ends with a space' }
  }
  return $problems
}

# GnuPG for Windows comes in two builds. Git for Windows bundles an MSYS build that
# needs /c/... for --homedir (a Windows path is read as relative and the run exits 2);
# a native build (Gpg4win) needs the Windows path.
function ConvertTo-GpgHomeArg([string]$GpgExe, [string]$Dir) {
  $full = [System.IO.Path]::GetFullPath($Dir)
  if ($full -cnotmatch '^[A-Za-z]:\\') { throw 'gpg home must be on a drive letter path' }
  if ($GpgExe -match '(?i)[\\/]usr[\\/]bin[\\/]gpg(\.exe)?$') {
    return '/' + $full.Substring(0, 1).ToLowerInvariant() + ($full.Substring(2) -replace '\\', '/')
  }
  return $full
}

function Get-ArchiveName([string]$DumpFileName) {
  if ($DumpFileName -cnotmatch ('^' + $SetBasePattern + '\.dump$')) { throw 'not a managed dump file name' }
  return ($DumpFileName -replace '\.dump$', '') + '.tar.gpg'
}

# Retention. Input: file names in the backup root. A "set" is a managed dump plus both
# sidecars with the same base name and a valid UTC timestamp; only complete sets count.
# Everything else - incomplete sets, .partial files, lookalike names, logs - is never
# selected for deletion.
function Select-RetentionSets([string[]]$FileNames = @(), [int]$Keep) {
  if ($Keep -lt 1) { throw 'Keep must be at least 1' }
  $sets = @{}
  $ignored = New-Object System.Collections.ArrayList
  foreach ($n in $FileNames) {
    $m = [regex]::Match($n, $ManagedFileRegex)
    if (-not $m.Success) { [void]$ignored.Add($n); continue }
    $base = $m.Groups[1].Value
    $kind = switch ($m.Groups[2].Value) { '' { 'dump' } '.sha256' { 'sha' } default { 'meta' } }
    if (-not $sets.ContainsKey($base)) { $sets[$base] = @{} }
    $sets[$base][$kind] = $n
  }
  $complete = @(); $incomplete = @()
  foreach ($base in $sets.Keys) {
    $s = $sets[$base]
    $ts = [datetime]::MinValue
    $tsText = [regex]::Match($base, '\d{8}T\d{6}Z').Value
    $okTime = [datetime]::TryParseExact($tsText, 'yyyyMMdd\THHmmss\Z', [System.Globalization.CultureInfo]::InvariantCulture, ([System.Globalization.DateTimeStyles]::AssumeUniversal -bor [System.Globalization.DateTimeStyles]::AdjustToUniversal), [ref]$ts)
    if ($okTime -and $s.ContainsKey('dump') -and $s.ContainsKey('sha') -and $s.ContainsKey('meta')) {
      $complete += [pscustomobject]@{ Base = $base; Time = $ts; Files = @($s['dump'], $s['sha'], $s['meta']) }
    } else { $incomplete += $base }
  }
  $ordered = @($complete | Sort-Object -Property @{ Expression = 'Time'; Descending = $true }, @{ Expression = 'Base'; Descending = $true })
  $kept = @($ordered | Select-Object -First $Keep)
  $drop = @($ordered | Select-Object -Skip $Keep)
  return [pscustomobject]@{
    Kept = @($kept | ForEach-Object { $_.Base })
    DeleteSets = @($drop | ForEach-Object { $_.Base })
    Delete = @($drop | ForEach-Object { $_.Files })
    Incomplete = @($incomplete | Sort-Object)
    Ignored = @($ignored)
  }
}

# ------------------------------------------------------------ path guards --
function Get-GitWorkTreeRoot([string]$Path) {
  $probe = [System.IO.Path]::GetFullPath($Path)
  while ($probe) {
    if (Test-Path -LiteralPath (Join-Path $probe '.git')) { return $probe }
    $parent = Split-Path $probe -Parent
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
  }
  return $null
}

# Evidence that a path is cloud-synchronised (empty = none): the same sources
# db-backup.ps1 checks - OS sync roots and client config (Get-CloudSyncRoots), name
# heuristics, and cloud placeholder attributes of the nearest existing ancestor.
function Get-CloudSyncHits([string]$Path) {
  $full = [System.IO.Path]::GetFullPath($Path)
  $hits = New-Object System.Collections.ArrayList
  foreach ($r in Get-CloudSyncRoots) { if (Test-PathUnder $full $r.Path) { [void]$hits.Add("$($r.Source): $($r.Path)") } }
  if ($full -match '(?i)\\(OneDrive[^\\]*|Dropbox|Google Drive|My Drive|iCloud ?Drive)(\\|$)') { [void]$hits.Add("path name segment '$($Matches[1])'") }
  $existing = $full
  while ($existing -and -not (Test-Path -LiteralPath $existing)) { $existing = Split-Path $existing -Parent }
  if ($existing) {
    $attr = [int](Get-Item -LiteralPath $existing -Force).Attributes
    $cloudAttrBits = 0x400 -bor 0x1000 -bor 0x40000 -bor 0x80000 -bor 0x100000 -bor 0x400000
    if ($attr -band $cloudAttrBits) { [void]$hits.Add(("cloud/placeholder file attributes on '{0}' (0x{1:x})" -f $existing, $attr)) }
  }
  return @($hits)
}

function Test-Overlap([string]$A, [string]$B) { return ((Test-PathUnder $A $B) -or (Test-PathUnder $B $A)) }

# The plaintext scratch folder: outside the repo and any Git work tree, never cloud-synced.
function Test-TempRootAllowed([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return [pscustomobject]@{ Ok = $false; Reason = 'no temp folder configured' } }
  if (Test-PathUnder $Path $RepoRoot) { return [pscustomobject]@{ Ok = $false; Reason = 'inside the repository' } }
  if (Get-GitWorkTreeRoot $Path) { return [pscustomobject]@{ Ok = $false; Reason = 'inside a Git work tree' } }
  $hits = @(Get-CloudSyncHits $Path)
  if ($hits.Count) { return [pscustomobject]@{ Ok = $false; Reason = ('cloud-synchronised: ' + ($hits -join '; ')) } }
  return [pscustomobject]@{ Ok = $true; Reason = 'accepted' }
}

# The encrypted-archive folder. Production (Dpapi): MUST be cloud-synced (that is the
# off-machine copy; a misconfigured local folder would silently give none). Dry run
# (Stdin, throwaway passphrase): must NOT be cloud-synced. Never overlaps the backup
# root, the historical folder or the temp root.
function Test-ArchiveDirAllowed([string]$Path, [string]$Source, [string]$Backups, [string]$Temp) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return [pscustomobject]@{ Ok = $false; Reason = 'no archive folder (OneDrive not found; pass -ArchiveDir)' } }
  if (Test-PathUnder $Path $RepoRoot) { return [pscustomobject]@{ Ok = $false; Reason = 'inside the repository' } }
  if (Get-GitWorkTreeRoot $Path) { return [pscustomobject]@{ Ok = $false; Reason = 'inside a Git work tree' } }
  foreach ($other in @($Backups, $HistoricalDir, $Temp)) {
    if ($other -and (Test-Overlap $Path $other)) { return [pscustomobject]@{ Ok = $false; Reason = "overlaps $other" } }
  }
  $cloud = (@(Get-CloudSyncHits $Path)).Count -gt 0
  if ($Source -eq 'Dpapi' -and -not $cloud) { return [pscustomobject]@{ Ok = $false; Reason = 'the production archive folder must be cloud-synchronised (the off-machine copy)' } }
  if ($Source -eq 'Stdin' -and $cloud) { return [pscustomobject]@{ Ok = $false; Reason = 'a throwaway-passphrase archive must never be written to a cloud-synchronised folder' } }
  return [pscustomobject]@{ Ok = $true; Reason = 'accepted' }
}

# ------------------------------------------------------------ passphrase --
function ConvertTo-PlainText([System.Security.SecureString]$Secure) {
  $bstr = [IntPtr]::Zero
  try {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if ($bstr -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}

function Read-StdinPassphrase {
  $Plain = [Console]::In.ReadLine()
  if ($null -eq $Plain) { throw 'no passphrase on stdin' }
  return $Plain.TrimEnd("`r", "`n")
}

# The passphrase for this run, from the configured source. Never printed or logged.
function Get-PlainPassphrase {
  if ($PassphraseSource -eq 'Stdin') {
    $Plain = Read-StdinPassphrase
  } else {
    if (-not (Test-Path -LiteralPath $PassphraseFile -PathType Leaf)) { throw 'no stored passphrase (the Owner runs -Mode SetupPassphrase first)' }
    $stored = [System.IO.File]::ReadAllText($PassphraseFile).Trim()
    try { $secure = ConvertTo-SecureString -String $stored } catch { throw 'the stored passphrase cannot be read by this Windows user (DPAPI); run SetupPassphrase -ReplaceExisting' }
    $Plain = ConvertTo-PlainText $secure
  }
  if (@(Test-PassphraseAcceptable $Plain).Count) { throw 'the passphrase does not meet the rules (20+ printable ASCII characters)' }
  return $Plain
}

# ------------------------------------------------------------ processes --
# Runs a program with stdin closed immediately (children never read ours), capturing
# stdout and stderr. The captured text may quote data on a failure: callers do not log it.
function Invoke-Proc([string]$Exe, [string]$ArgumentString, [int]$TimeoutMinutes = 90) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = $ArgumentString
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.Close()
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($TimeoutMinutes * 60 * 1000)) {
    try { $p.Kill() } catch { }
    return [pscustomobject]@{ ExitCode = -1; Out = ''; Err = "timed out after $TimeoutMinutes minutes" }
  }
  $p.WaitForExit()
  return [pscustomobject]@{ ExitCode = $p.ExitCode; Out = $outTask.Result; Err = $errTask.Result }
}

# The ONLY function that handles the passphrase and the ONLY one that writes it
# anywhere: to GnuPG's stdin. It is never part of the argument string.
function Invoke-Gpg([string]$GpgExe, [string]$Action, [string]$InFile, [string]$OutFile, [string]$HomeDir, [string]$Plain) {
  if ($Action -ne 'Encrypt' -and $Action -ne 'Decrypt') { throw 'unknown gpg action' }
  $homeArg = ConvertTo-GpgHomeArg $GpgExe $HomeDir
  $common = ('--batch --yes --no-tty --no-options --homedir "{0}" --pinentry-mode loopback --passphrase-fd 0 --no-symkey-cache' -f $homeArg)
  $verb = if ($Action -eq 'Encrypt') { '--symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo none' } else { '--decrypt' }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $GpgExe
  $psi.Arguments = ('{0} {1} -o "{2}" "{3}"' -f $common, $verb, $OutFile, $InFile)
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  $PlainBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Plain + "`n")
  try { $p.StandardInput.BaseStream.Write($PlainBytes, 0, $PlainBytes.Length); $p.StandardInput.BaseStream.Flush() }
  finally { $p.StandardInput.Close(); [Array]::Clear($PlainBytes, 0, $PlainBytes.Length) }
  if (-not $p.WaitForExit(30 * 60 * 1000)) { try { $p.Kill() } catch { }; return [pscustomobject]@{ ExitCode = -1; Err = 'gpg timed out' } }
  $p.WaitForExit()
  return [pscustomobject]@{ ExitCode = $p.ExitCode; Err = ($errTask.Result + $outTask.Result).Trim() }
}

function Resolve-Gpg([string]$Preferred) {
  $cands = @()
  if ($Preferred) { $cands += $Preferred }
  $cmd = Get-Command gpg.exe -ErrorAction SilentlyContinue
  if ($cmd) { $cands += $cmd.Source }
  foreach ($d in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA 'Programs'))) { if ($d) { $cands += (Join-Path $d 'Git\usr\bin\gpg.exe') } }
  $cands += 'C:\Program Files (x86)\GnuPG\bin\gpg.exe'
  foreach ($c in $cands) { if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c } }
  return $null
}

function Resolve-Tar {
  $sys = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path -LiteralPath $sys -PathType Leaf) { return $sys }
  $cmd = Get-Command tar.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

# ------------------------------------------------------------ temp folders --
function Remove-RunDir([string]$Dir) {
  $full = [System.IO.Path]::GetFullPath($Dir)
  $root = [System.IO.Path]::GetFullPath($TempRoot).TrimEnd('\')
  if ((Split-Path $full -Parent) -ine $root -or (Split-Path $full -Leaf) -cnotmatch $RunDirRegex) { throw 'refusing to delete an unexpected temp path' }
  for ($i = 0; $i -lt 5; $i++) {
    if (-not (Test-Path -LiteralPath $full)) { return $true }
    try { [System.IO.Directory]::Delete($full, $true) } catch { Start-Sleep -Milliseconds 400 }
  }
  return (-not (Test-Path -LiteralPath $full))
}

# Leftovers of a run that was killed before its finally block: only run-<guid> folders
# under the temp root, older than $StaleRunDirHours.
function Remove-StaleRunDirs {
  if (-not (Test-Path -LiteralPath $TempRoot)) { return }
  foreach ($d in [System.IO.Directory]::GetDirectories($TempRoot)) {
    $leaf = Split-Path $d -Leaf
    if ($leaf -cmatch $RunDirRegex -and ([System.IO.Directory]::GetLastWriteTime($d) -lt (Get-Date).AddHours(-$StaleRunDirHours))) {
      if ($DryRun) { Write-Log "DRY RUN: would remove stale temp folder $leaf"; continue }
      $gone = Remove-RunDir $d
      Write-Log ("removed stale temp folder {0}: {1}" -f $leaf, $(if ($gone) { 'yes' } else { 'FAILED' })) $(if ($gone) { 'INFO' } else { 'WARN' })
    }
  }
}

# ------------------------------------------------------------ db-backup.ps1 --
# Runs one db-backup.ps1 mode as a child process. Only check NAMES and summary lines are
# logged; its raw output is never logged because a failure can quote data.
function Invoke-DbBackup([string]$DbMode, [string]$DumpPath) {
  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $argText = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Mode {1}' -f $DbBackupScript, $DbMode
  if ($DbMode -eq 'Backup') { $argText += (' -BackupRoot "{0}"' -f $BackupRoot) } else { $argText += (' -DumpPath "{0}"' -f $DumpPath) }
  Write-Log "db-backup.ps1 -Mode $DbMode ..."
  $r = Invoke-Proc $psExe $argText
  $lines = @($r.Out -split "\r?\n")
  foreach ($l in $lines) {
    $m = [regex]::Match($l, '^\s*\[(PASS|FAIL)\]\s+(.+?)(\s+-\s+.*)?$')
    if ($m.Success) { Write-Log ("  [{0}] {1}" -f $m.Groups[1].Value, $m.Groups[2].Value) }
    elseif ($l -match '^(BACKUP OK:|RESTORE TEST \(|LIVE DRIFT \(|CLEANUP:|SELF-TEST:)') { Write-Log ("  " + $l.Trim()) }
  }
  $verdictLine = "$($lines | Where-Object { $_ -match ('^' + $DbMode.ToUpperInvariant() + ': (PASS|FAIL)$') } | Select-Object -Last 1)"
  $verdict = [regex]::Match($verdictLine, '(PASS|FAIL)$').Value
  $pass = ($r.ExitCode -eq 0 -and $verdict -eq 'PASS')
  $dump = $null
  if ($DbMode -eq 'Backup') {
    $ok = [regex]::Match(($lines -join "`n"), '(?m)^BACKUP OK: (.+?)\s*$')
    if ($ok.Success) { $dump = $ok.Groups[1].Value }
    if ($pass -and -not $dump) { $pass = $false; Write-Log '  Backup reported PASS but no dump path was found' 'WARN' }
  }
  if (-not $pass) { Write-Log "  db-backup.ps1 $DbMode FAILED (exit $($r.ExitCode)). Its raw output is not logged (a failure can quote data); re-run it by hand to see it." 'ERROR' }
  return [pscustomobject]@{ Pass = $pass; DumpPath = $dump }
}

# ================================================================== modes ==
function Invoke-SetupPassphrase {
  if (-not [Environment]::UserInteractive) { Write-Host 'SetupPassphrase needs an interactive terminal.'; return $false }
  if ((Test-Path -LiteralPath $PassphraseFile) -and -not $ReplaceExisting) {
    Write-Host 'A passphrase is already stored. Re-run with -ReplaceExisting to replace it.'
    Write-Host 'Archives made with the old passphrase still need the OLD passphrase.'
    return $false
  }
  $secure1 = Read-Host -AsSecureString 'Archive passphrase (20+ printable ASCII characters, from your password manager)'
  $secure2 = Read-Host -AsSecureString 'Repeat the passphrase'
  $Plain1 = ConvertTo-PlainText $secure1
  $Plain2 = ConvertTo-PlainText $secure2
  $problems = @(Test-PassphraseAcceptable $Plain1)
  if ($Plain1 -cne $Plain2) { $problems += 'the two entries differ' }
  $Plain1 = $null; $Plain2 = $null
  if ($problems.Count) { Write-Host ('Not stored: ' + ($problems -join '; ')); return $false }
  $dir = Split-Path $PassphraseFile -Parent
  if (Test-PathUnder $PassphraseFile $RepoRoot) { Write-Host 'Not stored: the passphrase file must be outside the repository.'; return $false }
  $cloud = @(Get-CloudSyncHits $PassphraseFile)
  if ($cloud.Count) { Write-Host 'Not stored: the passphrase file must not be in a cloud-synchronised folder.'; return $false }
  if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir) }
  [System.IO.File]::WriteAllText($PassphraseFile, (ConvertFrom-SecureString -SecureString $secure1), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host 'stored'
  return $true
}

function Invoke-Run {
  $ok = $true
  $started = Get-Date
  $runDir = $null
  $Plain = $null
  $setBase = $null

  if (-not (Test-Path -LiteralPath $LogDir)) { [void](New-Item -ItemType Directory -Path $LogDir) }
  $script:LogFile = Join-Path $LogDir ('backup-{0}.log' -f $started.ToString('yyyyMMdd-HHmmss'))
  Write-Log ("RUN start. passphrase source: {0}; keep {1} sets; dry run: {2}" -f $PassphraseSource, $KeepSets, [bool]$DryRun)

  $tempCheck = Test-TempRootAllowed $TempRoot
  if (-not $tempCheck.Ok) { Write-Log "temp folder refused: $($tempCheck.Reason)" 'ERROR'; return $false }
  if ((Test-Overlap $TempRoot $BackupRoot) -or (Test-Overlap $TempRoot $HistoricalDir)) { Write-Log 'temp folder overlaps a backup folder' 'ERROR'; return $false }

  try {
    # The passphrase is read before any child process starts (children never see stdin).
    $plainError = $null
    try { $Plain = Get-PlainPassphrase } catch { $plainError = $_.Exception.Message }

    if (-not (Test-Path -LiteralPath $TempRoot)) { [void](New-Item -ItemType Directory -Path $TempRoot) }
    Remove-StaleRunDirs
    $runDir = Join-Path $TempRoot ('run-' + [guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $runDir)

    # ---- 1. backup + verify (any FAIL ends the run) ----
    Write-Log '== 1. Backup and Verify'
    $b = Invoke-DbBackup 'Backup' $null
    if (-not $b.Pass) { Write-Log 'Backup failed; nothing else was done.' 'ERROR'; return $false }
    $dumpPath = [System.IO.Path]::GetFullPath($b.DumpPath)
    $dumpName = Split-Path $dumpPath -Leaf
    if ($dumpName -cnotmatch ('^' + $SetBasePattern + '\.dump$') -or (Split-Path $dumpPath -Parent) -ine [System.IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')) {
      Write-Log 'the reported dump is not a managed file in the backup root; stopping' 'ERROR'; return $false
    }
    $setBase = $dumpName -replace '\.dump$', ''
    $v = Invoke-DbBackup 'Verify' $dumpPath
    if (-not $v.Pass) { Write-Log 'Verify failed; nothing else was done.' 'ERROR'; return $false }

    # ---- 2. weekly restore test ----
    $weekly = ($WithRestoreTest.IsPresent -or (Test-IsWeeklyDay (Get-Date)))
    Write-Log ('== 2. RestoreTest ({0})' -f $(if ($weekly) { 'weekly run' } else { 'not today; weekly on Sunday or -WithRestoreTest' }))
    if ($weekly) {
      $rt = Invoke-DbBackup 'RestoreTest' $dumpPath
      if (-not $rt.Pass) { $ok = $false; Write-Log 'RestoreTest FAILED; continuing so the new backup is still copied off-machine.' 'ERROR' }
    }

    # ---- 3. bundle, encrypt, write the off-machine copy ----
    Write-Log '== 3. Encrypt and write the off-machine copy'
    $offsiteOk = $false
    $final = $null
    $gpg = Resolve-Gpg $GpgPath
    $tar = Resolve-Tar
    $archiveCheck = Test-ArchiveDirAllowed $ArchiveDir $PassphraseSource $BackupRoot $TempRoot
    if ($plainError) { Write-Log "passphrase: $plainError" 'ERROR' }
    elseif (-not $gpg) { Write-Log 'gpg.exe not found (Git for Windows bundles one; or install Gpg4win)' 'ERROR' }
    elseif (-not $tar) { Write-Log 'tar.exe not found' 'ERROR' }
    elseif (-not $archiveCheck.Ok) { Write-Log "archive folder refused: $($archiveCheck.Reason)" 'ERROR' }
    else {
      Write-Log "gpg: $gpg"
      if (-not (Test-Path -LiteralPath $ArchiveDir)) { [void](New-Item -ItemType Directory -Path $ArchiveDir) }
      $archiveName = Get-ArchiveName $dumpName
      $final = Join-Path $ArchiveDir $archiveName
      $partial = "$final.partial"
      if ((Test-Path -LiteralPath $final) -or (Test-Path -LiteralPath $partial)) { Write-Log "refusing to overwrite an existing archive file in the archive folder ($archiveName)" 'ERROR' }
      else {
        $tarPath = Join-Path $runDir ($setBase + '.tar')
        $files = @($dumpName, "$dumpName.sha256", "$dumpName.meta.json")
        $t = Invoke-Proc $tar ('-cf "{0}" -C "{1}" "{2}" "{3}" "{4}"' -f $tarPath, [System.IO.Path]::GetFullPath($BackupRoot), $files[0], $files[1], $files[2])
        $tarOk = ($t.ExitCode -eq 0 -and (Test-Path -LiteralPath $tarPath -PathType Leaf) -and (Get-Item -LiteralPath $tarPath).Length -gt 0)
        Write-Log ("tar of the 3 files (temp, non-cloud): {0}" -f $(if ($tarOk) { 'ok' } else { "FAILED (exit $($t.ExitCode))" }))
        if ($tarOk) {
          $homeDir = Join-Path $runDir 'gnupg-enc'
          [void](New-Item -ItemType Directory -Path $homeDir)
          $e = Invoke-Gpg $gpg 'Encrypt' $tarPath $partial $homeDir $Plain
          $encOk = ($e.ExitCode -eq 0 -and (Test-Path -LiteralPath $partial -PathType Leaf) -and (Get-Item -LiteralPath $partial).Length -gt 0)
          Write-Log ("gpg symmetric AES256 encrypt: {0}" -f $(if ($encOk) { "ok ($((Get-Item -LiteralPath $partial).Length) bytes)" } else { "FAILED (exit $($e.ExitCode)): $($e.Err.Substring(0, [Math]::Min(200, $e.Err.Length)))" }))
          if ($encOk) {
            Move-Item -LiteralPath $partial -Destination $final
            Write-Log "archive written: $archiveName (renamed from .partial last)"
            $offsiteOk = $true
          } elseif (Test-Path -LiteralPath $partial) {
            Remove-Item -LiteralPath $partial
            Write-Log 'removed this run''s unfinished .partial archive'
          }
        }
        # the plaintext tar is deleted right here as well as in finally
        if (Test-Path -LiteralPath $tarPath) { Remove-Item -LiteralPath $tarPath }
      }
    }
    if (-not $offsiteOk) { $ok = $false }

    # ---- 4. verify the off-machine copy ----
    $verifiedOffsite = $false
    Write-Log '== 4. Verify the off-machine copy (decrypt, untar, compare)'
    if ($offsiteOk) {
      $dec = Join-Path $runDir 'verify.tar'
      $out = Join-Path $runDir 'verify'
      $homeDir2 = Join-Path $runDir 'gnupg-dec'
      [void](New-Item -ItemType Directory -Path $homeDir2)
      [void](New-Item -ItemType Directory -Path $out)
      $d = Invoke-Gpg $gpg 'Decrypt' $final $dec $homeDir2 $Plain
      $decOk = ($d.ExitCode -eq 0 -and (Test-Path -LiteralPath $dec -PathType Leaf))
      Write-Log ("gpg decrypt of the archive: {0}" -f $(if ($decOk) { 'ok' } else { "FAILED (exit $($d.ExitCode))" }))
      if ($decOk) {
        $x = Invoke-Proc $tar ('-xf "{0}" -C "{1}"' -f $dec, $out)
        $present = @([System.IO.Directory]::GetFiles($out) | ForEach-Object { Split-Path $_ -Leaf } | Sort-Object)
        $expected = @($files | Sort-Object)
        $namesOk = ($x.ExitCode -eq 0 -and $present.Count -eq 3 -and (($present -join '|') -ceq ($expected -join '|')))
        Write-Log ("untar: {0} files {1}" -f $present.Count, $(if ($namesOk) { 'exactly the expected set' } else { 'NOT the expected set' }))
        if ($namesOk) {
          $allSame = $true
          foreach ($f in $files) {
            $a = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $BackupRoot $f)).Hash
            $c = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $out $f)).Hash
            if ($a -ne $c) { $allSame = $false }
          }
          $sidecarHash = ([System.IO.File]::ReadAllText((Join-Path $out "$dumpName.sha256")).Trim() -split '\s+')[0].ToLowerInvariant()
          $dumpHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $out $dumpName)).Hash.ToLowerInvariant()
          $hashOk = ($dumpHash -ceq $sidecarHash)
          Write-Log ("decrypted dump SHA256 equals its .sha256 sidecar: {0}" -f $(if ($hashOk) { "yes ($dumpHash)" } else { 'NO' }))
          Write-Log ("all 3 decrypted files are byte-identical to the local set: {0}" -f $(if ($allSame) { 'yes' } else { 'NO' }))
          $verifiedOffsite = ($hashOk -and $allSame)
        }
      }
      if (-not $verifiedOffsite) { $ok = $false; Write-Log 'off-machine copy verification FAILED' 'ERROR' }
    } else { Write-Log 'skipped (no archive was written)' 'WARN' }

    # ---- 5. local retention (only when the off-machine copy is proven) ----
    Write-Log "== 5. Local retention (keep the newest $KeepSets complete sets)"
    if (-not $verifiedOffsite) {
      Write-Log 'skipped: nothing is pruned unless this run''s off-machine copy was verified' 'WARN'
    } else {
      $root = [System.IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')
      if ($root -ieq $HistoricalDir -or (Test-Overlap $root $ArchiveDir)) { Write-Log 'retention refused: the backup root is the historical or archive folder' 'ERROR'; $ok = $false }
      else {
        $names = @([System.IO.Directory]::GetFiles($root) | ForEach-Object { Split-Path $_ -Leaf })
        $sel = Select-RetentionSets $names $KeepSets
        Write-Log ("complete sets: {0} kept, {1} to delete; incomplete sets left alone: {2}; other files ignored: {3}" -f $sel.Kept.Count, $sel.DeleteSets.Count, $sel.Incomplete.Count, $sel.Ignored.Count)
        if ($sel.Kept -cnotcontains $setBase) { Write-Log 'retention refused: the set made by this run is not among the kept sets' 'ERROR'; $ok = $false }
        else {
          foreach ($n in $sel.Delete) {
            $path = Join-Path $root $n
            if ($n -cnotmatch $ManagedFileRegex -or (Split-Path $path -Parent) -ine $root) { throw 'refusing to delete a non-managed name' }
            if ($DryRun) { Write-Log "DRY RUN: would delete $n"; continue }
            if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path }
            if (Test-Path -LiteralPath $path) { Write-Log "could not delete $n" 'ERROR'; $ok = $false } else { Write-Log "deleted $n" }
          }
          if ($DryRun -and $sel.Delete.Count -eq 0) { Write-Log 'DRY RUN: nothing would be deleted' }
        }
      }
    }
  } catch {
    $ok = $false
    Write-Log "ERROR: $($_.Exception.Message)" 'ERROR'
  } finally {
    $Plain = $null
    if ($runDir) {
      $gone = $false
      try { $gone = Remove-RunDir $runDir } catch { Write-Log "temp cleanup error: $($_.Exception.Message)" 'ERROR' }
      Write-Log ("temp plaintext folder removed: {0}" -f $(if ($gone) { 'yes' } else { 'NO - REAL DATA MAY REMAIN IN ' + $runDir }))
      if (-not $gone) { $ok = $false }
    }
  }
  Write-Log ("RUN end ({0:N0}s): {1}" -f ((Get-Date) - $started).TotalSeconds, $(if ($ok) { 'PASS' } else { 'FAIL' }))
  return $ok
}

# Where the passphrase variable (any $Plain*) is used in a script's AST, and whether that
# use could leak it: only the allow-listed functions may touch it, only Invoke-Gpg and
# Test-PassphraseAcceptable may receive it as a command argument, it is never interpolated
# into a string, and no process Arguments assignment mentions it. Empty result = clean.
function Find-PassphraseLeaks($Ast) {
  $allowedFns = @('Get-PlainPassphrase', 'Read-StdinPassphrase', 'ConvertTo-PlainText', 'Invoke-Gpg', 'Invoke-SetupPassphrase', 'Test-PassphraseAcceptable', 'Invoke-Run')
  $allowedCmds = @('Invoke-Gpg', 'Test-PassphraseAcceptable')
  $enclosing = { param($n) $p = $n.Parent; while ($p -and $p -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $p = $p.Parent }; if ($p) { $p.Name } else { '<script>' } }
  $found = @()
  foreach ($v in @($Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.UserPath -cmatch '^Plain' }, $true))) {
    $fn = & $enclosing $v
    if ($allowedFns -cnotcontains $fn) { $found += "L$($v.Extent.StartLineNumber): passphrase variable in $fn" }
    $p = $v.Parent
    while ($p) {
      if ($p -is [System.Management.Automation.Language.CommandAst] -and $allowedCmds -cnotcontains $p.GetCommandName()) { $found += "L$($v.Extent.StartLineNumber): passphrase variable in a command line ($($p.GetCommandName()))" }
      if ($p -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) { $found += "L$($v.Extent.StartLineNumber): passphrase variable interpolated into a string" }
      $p = $p.Parent
    }
  }
  foreach ($a in @($Ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -match 'Arguments$' }, $true))) {
    if (@($a.Right.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] -and $n.VariablePath.UserPath -cmatch '^Plain' }, $true)).Count) { $found += "L$($a.Extent.StartLineNumber): passphrase variable in an Arguments assignment" }
  }
  return $found
}

function Invoke-SelfTest {
  Write-Host ''
  Write-Host '== Self-test (no Docker, no database, no file writes)'
  $rows = @()
  function New-Row([string]$Case, [string]$Expected, [string]$Actual) {
    [pscustomobject]@{ Case = $Case; Expected = $Expected; Actual = $Actual; Result = $(if ($Expected -ceq $Actual) { 'PASS' } else { 'FAIL' }) }
  }

  # --- retention selection ---
  function New-SetNames([datetime]$Time, [int]$Pg = 16) {
    $base = 'ai_investment_copilot_{0}_pg{1}' -f $Time.ToString('yyyyMMdd\THHmmss\Z'), $Pg
    return @("$base.dump", "$base.dump.sha256", "$base.dump.meta.json")
  }
  $t0 = [datetime]::SpecifyKind([datetime]'2026-09-01T03:00:00', 'Utc')
  $names = @(); 0..34 | ForEach-Object { $names += New-SetNames $t0.AddDays($_) }   # 35 complete sets
  $sel = Select-RetentionSets $names 30
  $oldest5 = @(0..4 | ForEach-Object { New-SetNames $t0.AddDays($_) } | ForEach-Object { $_ })
  $rows += New-Row 'retention: 35 complete sets, keep 30 -> 5 sets (15 files) deleted' '30 kept / 5 sets / 15 files' ('{0} kept / {1} sets / {2} files' -f $sel.Kept.Count, $sel.DeleteSets.Count, $sel.Delete.Count)
  $rows += New-Row 'retention: the deleted files are exactly the 5 oldest sets' 'True' ([string]((($sel.Delete | Sort-Object) -join '|') -ceq (($oldest5 | Sort-Object) -join '|')))
  $rows += New-Row 'retention: the newest set is kept' 'True' ([string]($sel.Kept -ccontains ('ai_investment_copilot_{0}_pg16' -f $t0.AddDays(34).ToString('yyyyMMdd\THHmmss\Z'))))
  $sel = Select-RetentionSets $names[0..89] 30
  $rows += New-Row 'retention: exactly 30 sets -> nothing deleted' '0' ([string]$sel.Delete.Count)
  $rows += New-Row 'retention: no files -> nothing deleted' '0' ([string](Select-RetentionSets @() 30).Delete.Count)
  $rows += New-Row 'retention: keep 1 of 35 keeps only the newest' '1 kept / 34 sets' ('{0} kept / {1} sets' -f (Select-RetentionSets $names 1).Kept.Count, (Select-RetentionSets $names 1).DeleteSets.Count)
  $threw = $false; try { [void](Select-RetentionSets $names 0) } catch { $threw = $true }
  $rows += New-Row 'retention: keep 0 is refused' 'True' ([string]$threw)

  $mixed = @()
  $mixed += New-SetNames $t0 15; $mixed += New-SetNames $t0.AddDays(1) 16; $mixed += New-SetNames $t0.AddDays(2) 16
  $mixed += @('ai_investment_copilot_20250101T000000Z_pg16.dump', 'ai_investment_copilot_20250101T000000Z_pg16.dump.sha256')       # incomplete: no meta
  $mixed += @('ai_investment_copilot_20250202T000000Z_pg16.dump.meta.json')                                                       # sidecar only
  $mixed += @('ai_investment_copilot_20261301T000000Z_pg16.dump', 'ai_investment_copilot_20261301T000000Z_pg16.dump.sha256', 'ai_investment_copilot_20261301T000000Z_pg16.dump.meta.json')   # month 13
  $look = @('ai_investment_copilot_20260101T000000Z_pg16.dump.bak', 'ai_investment_copilot_20260101T000000Z_pg16.dump.sha256.partial', 'ai_investment_copilot_20260101T000000Z_pg16.dump.partial',
    'ai_investment_copilot_20260101T000000Z_pg16.dump.meta.json.partial', 'xai_investment_copilot_20260101T000000Z_pg16.dump', 'ai_investment_copilot_20260101t000000z_pg16.dump',
    'ai_investment_copilot_20260101T000000Z_pg.dump', 'ai_investment_copilot_20260101T000000Z_pg16.dump.sha256.bak', 'ai_investment_copilot_20260101T000000Z_pg16.DUMP', 'notes.txt', 'logs',
    'ai_investment_copilot_20260101T000000Z_pg16.tar.gpg')
  $sel = Select-RetentionSets ($mixed + $look) 2
  $rows += New-Row 'retention (mixed): complete sets of two pg majors count; keep 2 deletes the oldest 1 set' '2 kept / 1 sets / 3 files' ('{0} kept / {1} sets / {2} files' -f $sel.Kept.Count, $sel.DeleteSets.Count, $sel.Delete.Count)
  $rows += New-Row 'retention (mixed): incomplete and invalid-date sets are listed, never deleted' '3' ([string]$sel.Incomplete.Count)
  $rows += New-Row 'retention (mixed): no incomplete/lookalike name is in the delete list' '0' ([string]@($sel.Delete | Where-Object { $_ -notmatch ('^ai_investment_copilot_{0}_pg15\.dump' -f $t0.ToString('yyyyMMdd\THHmmss\Z')) }).Count)
  $rows += New-Row 'retention (mixed): all 12 lookalike names are ignored' '12' ([string]@($sel.Ignored | Where-Object { $look -ccontains $_ }).Count)
  $rows += New-Row 'retention: every deleted name matches the managed pattern' 'True' ([string](@($sel.Delete | Where-Object { $_ -cnotmatch $ManagedFileRegex }).Count -eq 0))

  # --- path guards ---
  $tmpDefault = 'C:\dev-private\backup-tmp'
  $rows += New-Row 'guard: default temp folder is accepted (outside repo, not cloud-synced)' 'True' ([string](Test-TempRootAllowed $tmpDefault).Ok)
  $rows += New-Row 'guard: a temp folder inside the repository is refused' 'False' ([string](Test-TempRootAllowed (Join-Path $RepoRoot 'tmp')).Ok)
  if ($env:OneDrive) {
    $od = Join-Path $env:OneDrive 'ai-investment-copilot-backups'
    $rows += New-Row 'guard: a temp folder in OneDrive is refused' 'False' ([string](Test-TempRootAllowed (Join-Path $env:OneDrive 'tmp')).Ok)
    $rows += New-Row 'guard: the default archive folder is detected as cloud-synced' 'True' ([string]((@(Get-CloudSyncHits $od)).Count -gt 0))
    $rows += New-Row 'guard: production archive folder (Dpapi) in OneDrive is accepted' 'True' ([string](Test-ArchiveDirAllowed $od 'Dpapi' $BackupRoot $tmpDefault).Ok)
    $rows += New-Row 'guard: throwaway passphrase (Stdin) into OneDrive is refused' 'False' ([string](Test-ArchiveDirAllowed $od 'Stdin' $BackupRoot $tmpDefault).Ok)
  } else {
    $rows += New-Row 'guard: OneDrive is configured on this machine' 'True' 'False'
  }
  $rows += New-Row 'guard: production archive folder outside the cloud (Dpapi) is refused' 'False' ([string](Test-ArchiveDirAllowed 'C:\dev-private\somewhere-local' 'Dpapi' $BackupRoot $tmpDefault).Ok)
  $rows += New-Row 'guard: throwaway-passphrase archive in a local folder (Stdin) is accepted' 'True' ([string](Test-ArchiveDirAllowed 'C:\dev-private\backup-dryrun-out' 'Stdin' $BackupRoot $tmpDefault).Ok)
  $rows += New-Row 'guard: no archive folder configured is refused' 'False' ([string](Test-ArchiveDirAllowed '' 'Dpapi' $BackupRoot $tmpDefault).Ok)
  $rows += New-Row 'guard: archive folder inside the backup root is refused' 'False' ([string](Test-ArchiveDirAllowed (Join-Path $BackupRoot 'x') 'Stdin' $BackupRoot $tmpDefault).Ok)
  $rows += New-Row 'guard: archive folder = the historical backup folder is refused' 'False' ([string](Test-ArchiveDirAllowed $HistoricalDir 'Stdin' $BackupRoot $tmpDefault).Ok)
  $rows += New-Row 'guard: archive folder inside the repository is refused' 'False' ([string](Test-ArchiveDirAllowed (Join-Path $RepoRoot 'out') 'Stdin' $BackupRoot $tmpDefault).Ok)
  $rows += New-Row 'guard: archive folder inside the temp root is refused' 'False' ([string](Test-ArchiveDirAllowed (Join-Path $tmpDefault 'out') 'Stdin' $BackupRoot $tmpDefault).Ok)

  # --- small pure helpers ---
  $rows += New-Row 'weekly: Sunday 2026-10-04 runs the restore test' 'True' ([string](Test-IsWeeklyDay ([datetime]'2026-10-04')))
  $rows += New-Row 'weekly: Monday 2026-10-05 does not' 'False' ([string](Test-IsWeeklyDay ([datetime]'2026-10-05')))
  $rows += New-Row 'passphrase: 20 printable ASCII characters is accepted' '0' ([string]@(Test-PassphraseAcceptable ('a1' * 10)).Count)
  $rows += New-Row 'passphrase: 19 characters is refused' '1' ([string]@(Test-PassphraseAcceptable ('a' * 19)).Count)
  $rows += New-Row 'passphrase: non-ASCII is refused' '1' ([string]@(Test-PassphraseAcceptable (('a' * 20) + [string][char]0x05D0)).Count)
  $rows += New-Row 'passphrase: leading space is refused' '1' ([string]@(Test-PassphraseAcceptable (' ' + ('a' * 20))).Count)
  $rows += New-Row 'passphrase: empty is refused' 'True' ([string](@(Test-PassphraseAcceptable '').Count -ge 1))
  $rows += New-Row 'gpg home: MSYS build gets /c/... form' '/c/dev-private/backup-tmp/x' (ConvertTo-GpgHomeArg 'C:\Program Files\Git\usr\bin\gpg.exe' 'C:\dev-private\backup-tmp\x')
  $rows += New-Row 'gpg home: native build keeps the Windows path' 'C:\dev-private\backup-tmp\x' (ConvertTo-GpgHomeArg 'C:\Program Files (x86)\GnuPG\bin\gpg.exe' 'C:\dev-private\backup-tmp\x')
  $rows += New-Row 'archive name: <set base>.tar.gpg' 'ai_investment_copilot_20261002T030128Z_pg16.tar.gpg' (Get-ArchiveName 'ai_investment_copilot_20261002T030128Z_pg16.dump')
  $threw = $false; try { [void](Get-ArchiveName 'something.dump') } catch { $threw = $true }
  $rows += New-Row 'archive name: a non-managed dump name is refused' 'True' ([string]$threw)
  $rows += New-Row 'temp folder pattern: only run-<32 hex>' '1 of 4' ('{0} of 4' -f @('run-0123456789abcdef0123456789abcdef', 'run-xyz', 'RUN-0123456789abcdef0123456789abcdef', 'run-0123456789abcdef0123456789abcdef.old' | Where-Object { $_ -cmatch $RunDirRegex }).Count)

  # --- static checks on this very file ---
  $tk = $null; $er = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tk, [ref]$er)
  $enclosing = { param($n) $p = $n.Parent; while ($p -and $p -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $p = $p.Parent }; if ($p) { $p.Name } else { '<script>' } }
  $leaks = @(Find-PassphraseLeaks $ast)
  $rows += New-Row 'static: the passphrase variable never reaches a command line, string, logger or Arguments' 'NONE' $(if ($leaks.Count) { $leaks -join '; ' } else { 'NONE' })
  # The check must be able to fail: synthetic code that leaks in each way is caught, clean code is not.
  $probe = {
    param([string]$Code)
    $t2 = $null; $e2 = $null
    @(Find-PassphraseLeaks ([System.Management.Automation.Language.Parser]::ParseInput($Code, [ref]$t2, [ref]$e2))).Count
  }
  $rows += New-Row 'static check catches: passphrase passed to Write-Host' 'True' ([string]((& $probe 'function Invoke-Gpg { param([string]$Plain) Write-Host $Plain }') -ge 1))
  $rows += New-Row 'static check catches: passphrase interpolated into a string' 'True' ([string]((& $probe 'function Invoke-Gpg { param([string]$Plain) $x = "pw=$Plain" }') -ge 1))
  $rows += New-Row 'static check catches: passphrase variable in a function not on the allow list' 'True' ([string]((& $probe 'function Invoke-Other { param([string]$Plain) $y = $Plain.Length }') -ge 1))
  $rows += New-Row 'static check catches: passphrase placed in a process Arguments string' 'True' ([string]((& $probe 'function Invoke-Gpg { param([string]$Plain) $psi.Arguments = ''x '' + $Plain }') -ge 1))
  $rows += New-Row 'static check accepts: the allowed uses (stdin bytes, validation, gpg call)' '0' ([string](& $probe 'function Invoke-Gpg { param([string]$Plain) $b = $enc.GetBytes($Plain + "x") }'))
  $gpgDef = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Gpg' }, $true)
  $rows += New-Row 'static: gpg is told to read the passphrase from stdin (--passphrase-fd 0)' 'True' ([string]($gpgDef.Extent.Text -match '--passphrase-fd 0'))
  $rows += New-Row 'static: gpg is run in batch/loopback mode and does not cache the passphrase' 'True' ([string]($gpgDef.Extent.Text -match '--batch' -and $gpgDef.Extent.Text -match '--pinentry-mode loopback' -and $gpgDef.Extent.Text -match '--no-symkey-cache'))
  $selfText = [System.IO.File]::ReadAllText($PSCommandPath)
  $rows += New-Row 'static: no transcript and no passphrase-as-argument option anywhere' 'True' ([string]($selfText -notmatch ('Start-' + 'Transcript') -and $selfText -notmatch ('--pass' + 'phrase ') -and $selfText -notmatch ('--pass' + 'phrase=')))
  $dbCalls = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-DbBackup' }, $true) | ForEach-Object { $_.Extent.Text })
  $rows += New-Row 'static: db-backup.ps1 is only used through Backup / Verify / RestoreTest' 'True' ([string](@($dbCalls | Where-Object { $_ -notmatch "Invoke-DbBackup '(Backup|Verify|RestoreTest)'" }).Count -eq 0))
  $delCalls = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Remove-Item' }, $true) | ForEach-Object { & $enclosing $_ })
  $rows += New-Row 'static: Remove-Item is used only in Invoke-Run (own tar/.partial, guarded retention)' 'True' ([string](@($delCalls | Where-Object { $_ -ne 'Invoke-Run' }).Count -eq 0))
  $rows += New-Row 'static: the db-backup.ps1 functions lifted by AST are available' 'True' ([string]((Get-Command Get-CloudSyncRoots -ErrorAction SilentlyContinue) -and (Get-Command Test-PathUnder -ErrorAction SilentlyContinue)))

  $rows | Format-Table -AutoSize | Out-String -Width 300 | Write-Host
  $failed = @($rows | Where-Object { $_.Result -ne 'PASS' }).Count
  Write-Host ("SELF-TEST: {0} of {1} cases PASS" -f ($rows.Count - $failed), $rows.Count)
  return ($failed -eq 0)
}

# ================================================================== main ==
$result = $false
try {
  switch ($Mode) {
    'SelfTest' { $result = Invoke-SelfTest }
    'SetupPassphrase' { $result = Invoke-SetupPassphrase }
    'Run' { $result = Invoke-Run }
  }
} catch {
  Write-Host ''
  Write-Host "ERROR: $($_.Exception.Message)"
  $result = $false
}
Write-Host ''
Write-Host ("{0}: {1}" -f $Mode.ToUpperInvariant(), $(if ($result) { 'PASS' } else { 'FAIL' }))
if ($result) { exit 0 } else { exit 1 }
