# Runbook — local database backup, verify and restore test

Production Readiness Unit 2A. Covers the **local Docker PostgreSQL** database
(`docker-compose.yml`, service `db`, data in `pgdata/`). Everything here runs
through one script: [`scripts/db-backup.ps1`](../scripts/db-backup.ps1).

> **Backups contain REAL FINANCIAL DATA** — every transaction, decision, note and
> interview answer of the investor. Store them only where the Owner has approved,
> never in the repository, never in a shared or cloud-synced folder by accident.
> Anyone who can read a `.dump` file can read the whole investment history.

## Prerequisites

- Windows PowerShell 5.1 (or later), Docker Desktop running, the `db`
  container up (`docker compose up -d`). See the README's "Docker Desktop stops
  itself" sections first if the container misbehaves — the variant-2 failure
  (silent data-mount loss while `docker ps` looks fine) is exactly why this
  routine exists.
- **Stop the dev server (`next dev` / `next start`) and any other client first.**
  The script refuses to run while any other session is connected to the live
  database (it never terminates sessions itself).
- No secrets are needed: the script talks to PostgreSQL inside the container
  over its local socket. It never reads `.env`, never prints a password or
  connection string, and never queries or prints row contents (only counts,
  hashes, names). **Failure output is not guaranteed free of data:** errors from
  `pg_dump` / `pg_restore` / `psql` are shown unfiltered so a failure can be
  diagnosed, and a PostgreSQL error can quote part of a row (for example the
  `COPY … line N: "…"` context of a failed restore). Treat the console output of
  a failed run as sensitive; do not paste it into shared places unreviewed.

## Commands

Run from the repository root. `-ExecutionPolicy Bypass` applies to that one
process only.

```powershell
# 1. Guard self-test (no Docker, no database). Must be all PASS.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode SelfTest

# 2. Backup (default destination C:\dev-private\backups)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode Backup
#    other destination:
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode Backup -BackupRoot D:\some\approved\folder

# 3. Verify one dump (restores nothing)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode Verify -DumpPath C:\dev-private\backups\<file>.dump

# 4. Restore test into a throwaway database, then drop it
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 -Mode RestoreTest -DumpPath C:\dev-private\backups\<file>.dump
```

Exit code `0` = every check passed; `1` = something failed (the output says which).

## What Backup produces

For each successful run, in the backup root (created if missing):

| File | Content |
|---|---|
| `<db>_<UTC yyyyMMddTHHmmssZ>_pg<major>.dump` | `pg_dump -Fc` custom-format dump (REAL DATA) |
| `….dump.sha256` | `sha256  filename` (sha256sum format) |
| `….dump.meta.json` | non-secret metadata: UTC time, Git HEAD, PostgreSQL version, database name, dump file name, dump size, SHA256, migration-ledger count and hashes, **per-table row counts at the backup point** |

The metadata never contains passwords, connection URLs, investor text or row values.

### Publication contract

**A file with the final `.dump` name means the complete backup set exists and
was validated.** The `.dump` rename is the last step of a run; nothing that can
still fail happens after it.

1. Git HEAD / working-tree state are collected **before** the dump (a Git
   failure stops the run before anything is written).
2. `pg_dump -Fc -f /tmp/aic-backup-<time>-<random>.dump` runs **inside the
   container**; the exit code and a non-empty file are checked.
3. `docker cp` copies the binary file to `<dump>.partial` on the host — the dump
   never passes through PowerShell text handling (no `>` / `Out-File`).
4. Host size must equal container size; the row counts are captured again and
   must be identical to the counts taken before the dump (with no other
   sessions connected, this is the stable comparison point stored in the
   metadata).
5. `<dump>.sha256.partial` and `<dump>.meta.json.partial` are written.
6. Validation, re-read from disk: the dump's SHA256 again, the `.sha256`
   sidecar's hash and file name, and the metadata's binding to the dump
   (sha256, file name, size).
7. Publish: `.sha256` and `.meta.json` are renamed to their final names, then
   the `.dump` **last**.
8. The container `/tmp` copy is removed in a `finally` block and its absence is
   checked.

On any failure before step 7 completes the run is reported FAIL and removes the
files **it created itself** (every one of the six possible names was proven
absent before the run started) — `.partial` files and, if the failure hit
between the sidecar renames and the `.dump` rename, the already-renamed
sidecars. Nothing else is touched. If the process is killed outright, leftovers
can only be `.partial` files or sidecars **without** a final `.dump`; neither is
a backup, and Verify refuses them. If only the container temp removal fails
after publication, the set is complete but the run reports FAIL and names the
container file that still holds data.

### Destination rules

The destination is refused when it is inside the repository, inside any Git
work tree, or appears to be **cloud-synchronised**. Evidence checked: the
`OneDrive*` environment variables, Windows sync roots
(`HKLM\…\Explorer\SyncRootManager`), OneDrive account folders, Dropbox
`info.json`, Google Drive (DriveFS), `%USERPROFILE%\iCloudDrive`, path-name
segments, and cloud placeholder file attributes. `-AllowCloudSyncedDestination`
overrides that refusal and must only be used by an explicit Owner decision.

**`db-backup.ps1` itself never deletes anything that existed before a run.**
It has no retention or pruning mode; the only deletions are a failed run's own
unpublished files (above). Retention exists only in the scheduled orchestrator
(`scripts/backup-scheduled.ps1`, next section), which never touches the two
historical dumps in `C:\dev-private\ai-investment-copilot-backups\`.

## Verify

Checks: file exists, non-empty, SHA256 equals the `.sha256` sidecar, the
`.meta.json` exists and **belongs to this dump** (written by this script, same
SHA256, same file name, same size), and `pg_restore --list` parses it (run
inside the container on a temporary copy that is removed and checked
afterwards). Nothing is restored. A dump with only a matching `.sha256` is
**not** a complete backup and fails Verify. Dumps not produced by this script
(for example the two historical dumps, made before it existed) are expected to
fail the metadata check.

## Restore test

Proves a dump restores to exactly what was backed up, without touching the live
database:

1. identifies the live database and passes the active-session gate;
2. verifies the dump (as above, including that the `.meta.json` belongs to it)
   and takes its metadata;
3. **generates** the throwaway name `ai_investment_copilot_restore_test_<yyyymmdd>t<hhmmss>z`
   and runs the destructive-name guard (create phase);
4. `CREATE DATABASE` through the maintenance database `postgres` — never through
   the live database. The database becomes **run-owned only if that CREATE
   exited 0**; ownership is recorded at once, then the catalog confirms it.
   A CREATE that fails never claims the name, even if a database with that name
   exists afterwards — such a database is reported as "NOT owned by this run"
   and is never dropped;
5. `docker cp` into the container. Before `pg_restore` runs, the container
   copy — the file `pg_restore` reads — is hashed **inside the container**
   (`sha256sum`, BusyBox in the alpine image) and must equal the verified
   SHA256; the copy's size and the host file's SHA256 (taken after the copy)
   are re-checked too. A mismatch, a missing `sha256sum`, a non-zero exit, or
   output that is not a 64-hex hash fails the run **before** `pg_restore`; the
   throwaway database is still dropped by the normal guarded cleanup. Only then
   `pg_restore --exit-on-error --no-owner` runs inside the container;
6. **restore verdict** (PASS/FAIL):
   - restored per-table row counts vs. the **backup metadata** counts — per
     table, missing and extra tables reported;
   - restored migration ledger vs. the **backup metadata** ledger — count and
     ordered hashes, exact. This is the authoritative ledger check;
   - backup ledger vs. the **repository** journal — informational, by migration
     identity (drizzle's `created_at` = the journal's `when`), so line-ending
     conversion of the migration files never matters. Equal → "equals the repo
     ledger"; an ordered prefix → "backup is N migrations behind the repo" (not a
     failure); repo shorter → "repo is N migrations behind the backup" (not a
     failure); **a divergence inside the common prefix → FAIL**;
7. **separately, never part of the verdict:** current live counts vs. backup
   metadata, reported as `DRIFT: NONE`, `DRIFT: DETECTED` (with the per-table
   table), or `DRIFT: UNKNOWN` with the reason when the live counts cannot be
   read (for example a damaged live database). Drift means the live database
   changed since the backup; it is not a restore failure;
8. cleanup (always runs, even after a failure): removes the container temp copy,
   re-runs the guard (drop phase) and drops **only** the run-owned database,
   then proves from `pg_database` that it is gone. If the primary step and a
   cleanup step both fail, both are printed (`PRIMARY FAILURE` / `CLEANUP
   FAILURE`) and the run is FAIL.

### The destructive-name guard and ownership

The guard refuses: empty name, the live database, `postgres`, `template0`,
`template1`, any name without the exact prefix, any name not matching
`^ai_investment_copilot_restore_test_\d{8}t\d{6}z$`, a name that already exists
(create phase), a database not present in the catalog (drop phase), a
non-restore-test mode, and an unverified server. It runs again immediately
before the DROP. What may be dropped at all is decided by ownership (step 4):
only a name whose CREATE by this run exited 0. The drop function takes **no
target argument**, and no `DROP … FORCE` exists anywhere in the script. The
self-test asserts the guard cases, the ownership transitions, and these
structural facts.

If cleanup fails the script says so prominently and does nothing broader; drop
the leftover throwaway database by hand only after checking its name.

## Scheduled backup with an encrypted off-machine copy (Unit 5)

Production Readiness Unit 5 puts a schedule, an **encrypted** copy outside this
machine, and local retention around the commands above. Two scripts:

- [`scripts/backup-scheduled.ps1`](../scripts/backup-scheduled.ps1) — the
  orchestrator. It calls `db-backup.ps1` **unchanged** (Backup, Verify,
  RestoreTest) and never weakens its guards.
- [`scripts/register-backup-task.ps1`](../scripts/register-backup-task.ps1) —
  registers the Windows scheduled task (run once, by the Owner).

### What happens, and when

The task "AI Investment Copilot backup" runs **daily at 03:00** as the current
user, **only while the user is logged on** (the database lives in the user's
Docker). If the machine was off or asleep at 03:00 the run starts as soon as it
is available again ("start when available"). One run:

1. `db-backup.ps1 -Mode Backup`, then `-Mode Verify` on the new set. Any FAIL
   (including the active-session gate when the app or any client is open) ends
   the run: nothing else happens that day.
2. **Sundays** (or `-WithRestoreTest`): `-Mode RestoreTest` on the new set. A
   failed RestoreTest makes the run FAIL but the new backup is still copied
   off-machine.
3. The set (dump + `.sha256` + `.meta.json`) is bundled with `tar` in a
   **non-cloud** temp folder (`C:\dev-private\backup-tmp\run-<guid>`), encrypted
   with GnuPG symmetric **AES256**, and written to the OneDrive backups folder
   (`%OneDrive%\ai-investment-copilot-backups`) as `<set name>.tar.gpg.partial`,
   renamed to `<set name>.tar.gpg` last.
4. The archive is **verified from the OneDrive file**: decrypted in the temp
   folder, untarred, and all three files must be byte-identical to the local set
   (and the dump's SHA256 must equal its sidecar).
5. **Local retention:** keep the newest **30 complete sets** in
   `C:\dev-private\backups`; delete older ones. Only when step 4 passed. A set is
   complete when the dump and both sidecars exist with a valid UTC timestamp;
   incomplete sets, `.partial` files, logs and any name that does not match the
   exact managed pattern
   `ai_investment_copilot_<yyyymmddThhmmssZ>_pg<N>.dump[.sha256|.meta.json]` are
   never deleted. **OneDrive archives are never pruned automatically**, and
   `C:\dev-private\ai-investment-copilot-backups` (the historical dumps) is never
   touched.
6. The temp plaintext folder is deleted in a `finally` path; failure to delete it
   makes the run FAIL and the log names the folder.
7. **Failure alert:** every run, including one that fails before any backup is
   made (a refused folder, an exception), ends with `RUN end (<s>s): PASS|FAIL`
   in the log. On FAIL a Windows popup ("AI Investment Copilot - backup
   FAILED") shows the **first step that failed** and the **log file name** —
   no data, no paths. It closes itself after `-AlertTimeoutSeconds` (default
   3600 = one hour; `0` is refused because the popup would then wait forever),
   so a run is never blocked for longer. The task runs only while the user is
   logged on, so the popup appears on the Owner's desktop. One more log line
   follows `RUN end`: `failure alert shown; closed itself after N s` or
   `closed by the user` (or `could not be shown`).

Exit code `0` only if every step passed.

**No plaintext real data ever enters a cloud-synced folder.** Only the `.tar.gpg`
is written there. The temp folder is checked on every run: outside the
repository, outside any Git work tree, not cloud-synced. In production the
archive folder is **required** to be cloud-synced (so a misconfigured local
folder cannot silently stand in for the off-machine copy).

**The passphrase** is never on a command line, in output, in a log, or in any
file other than the DPAPI store. GnuPG reads it from stdin
(`--passphrase-fd 0 --pinentry-mode loopback --no-symkey-cache`). The
orchestrator's SelfTest includes a static check (with negative tests) that the
passphrase variable never reaches a command line, an interpolated string, a
logger or a process argument string.

### One-time setup (the Owner, in his own terminal)

Run from the repository root.

1. **Choose the passphrase and save it in the password manager first.** At least
   20 printable ASCII characters (a password-manager generated one is ideal).
   Without it the archives cannot be opened by anyone, ever.
2. Store it for the scheduled task (DPAPI, current Windows user; you type it
   twice, nothing is echoed):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode SetupPassphrase
   ```
   It prints only `stored`. The file is `C:\dev-private\backup-secrets\passphrase.dpapi`
   (outside the repo, not cloud-synced, readable only by this Windows user on this
   machine).
3. Register the task:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
   ```
   It prints the definition and starts nothing. (`-PrintOnly` shows it without
   registering.)
4. Copy `.env` into the password manager yourself (it is **not** in any backup).
5. Optional first run (the app must be closed):
   `Start-ScheduledTask -TaskName 'AI Investment Copilot backup'`, then read the
   newest log (below) and check the `.tar.gpg` appeared in OneDrive.

Re-run step 2 with `-ReplaceExisting` to change the passphrase. Archives written
earlier still need the **old** passphrase; keep it in the password manager until
those archives are gone or re-encrypted by hand.

### Restore from OneDrive on a NEW machine (plain GnuPG, no script)

Recovery does not depend on `backup-scheduled.ps1`. You need: the `.tar.gpg` file
(from the OneDrive folder, any machine signed in to it), the passphrase from the
password manager, and any GnuPG (Git for Windows bundles one at
`C:\Program Files\Git\usr\bin\gpg.exe`; Gpg4win; `apt install gnupg`;
`brew install gnupg`).

```powershell
# 1. decrypt (gpg asks for the passphrase; type or paste it from the password manager)
gpg --decrypt --output set.tar ai_investment_copilot_<yyyymmddThhmmssZ>_pg16.tar.gpg
# 2. unpack: the dump, its .sha256 and its .meta.json
tar -xf set.tar
# 3. check the dump against its sidecar (must equal the hash in the .sha256 file)
Get-FileHash -Algorithm SHA256 ai_investment_copilot_<...>_pg16.dump
#    (Linux/macOS: sha256sum -c ai_investment_copilot_<...>_pg16.dump.sha256)
```

Then follow "Real disaster restore" below from step 6 with that `.dump`, into a
PostgreSQL **16** container (the metadata names the version). The application
also needs `.env` (`DATABASE_URL`, `POSTGRES_PASSWORD`, `SESSION_SECRET`,
`ANTHROPIC_API_KEY`, `FMP_API_KEY`) from the password manager, and the code from
GitHub. (On Git for Windows' MSYS `gpg`, a Windows path given to `--homedir` is
misread; this plain use does not need `--homedir` at all.)

### Where things are

| What | Where |
|---|---|
| Local backup sets | `C:\dev-private\backups` (newest 30) |
| Encrypted off-machine copies | `%OneDrive%\ai-investment-copilot-backups\<set>.tar.gpg` (all, never pruned) |
| Run logs | `C:\dev-private\backups\logs\backup-<yyyyMMdd-HHmmss>.log` |
| Passphrase store (DPAPI) | `C:\dev-private\backup-secrets\passphrase.dpapi` |
| Plaintext scratch (deleted every run) | `C:\dev-private\backup-tmp\run-<guid>` |
| Task | Task Scheduler, "AI Investment Copilot backup" (`Get-ScheduledTaskInfo` shows the last result) |

Logs hold only step names, PASS/FAIL, counts, sizes, hashes and paths — never the
passphrase or row data. **Raw `db-backup.ps1` output is deliberately not
logged** (a failure can quote data); on a FAILED step re-run that step by hand to
see its output. Logs are not pruned automatically (a few KB each). Every run
writes `RUN end (<seconds>s): PASS` or `FAIL`, even after an early failure; a
failed run says which step failed, and the failure-alert line follows it.

### Manual runs

```powershell
# pure checks, no Docker/DB/writes (must be all PASS)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode SelfTest
# a real run now, with the restore test, listing (not performing) retention deletions
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode Run -WithRestoreTest -DryRun
# a real run now
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode Run
# see the failure popup without making a backup: a temp folder that overlaps the
# backup root fails at setup; the popup closes itself after 5 s
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup-scheduled.ps1 -Mode Run -TempRoot C:\dev-private\alert-probe\tmp -BackupRoot C:\dev-private\alert-probe\tmp\bk -LogDir C:\dev-private\alert-probe\logs -AlertTimeoutSeconds 5
```

### What this does NOT cover

- **`.env` and any secret** — not backed up by anything here (the Owner keeps `.env`
  in the password manager). The code is on GitHub.
- **Passphrase loss** — archives are unrecoverable without it. There is no escrow.
- **Loss of the Windows profile / a new machine** — the DPAPI store is bound to
  this Windows user on this machine, so a new machine needs `SetupPassphrase`
  again (with the same passphrase from the password manager).
- **OneDrive-side failures** — OneDrive can sync a deletion or a corrupted file;
  its version history / recycle bin are the only protection (no immutable copy).
  The run verifies the file it wrote at write time, not later.
- **Failure alerts beyond the popup** — a failed run shows a local popup for up
  to an hour (step 7), and nothing else: no mail, no phone notification. A popup
  missed while away from the machine leaves only the log and Task Scheduler's
  "Last Run Result". A run that never starts (machine off for days, task
  disabled) shows nothing at all. Check the newest log now and then.
- **Runs while the app is open** — the active-session gate refuses to back up while
  any client is connected, so a 03:00 run with the dev server up produces no
  backup that day. The task runs only while the user is logged on.
- **Local dumps are plaintext on disk** (`C:\dev-private\backups`, and the two
  historical dumps). Only the off-machine copy is encrypted. Whether the disk is
  encrypted (BitLocker) was not checked.
- **RPO** is up to 24 hours (longer if runs are skipped as above); **RTO** is not
  defined or rehearsed on a second machine.

## Real disaster restore (documented only — not automated, never run by the script)

Use when the live database is damaged, was dropped, or `pgdata/` is lost.
**This procedure contains no `DROP`.** Nothing is ever destroyed; whatever holds
the live name is renamed aside and kept.

Three names, never mixed up (`<yyyymmdd>` = today, digits only):

| Name | What it is |
|---|---|
| `ai_investment_copilot` | **live name** — whatever currently holds it: the damaged database, or the EMPTY one `docker compose up` creates when `pgdata/` was lost, or the empty placeholder from step 3 |
| `ai_investment_copilot_recovered_<yyyymmdd>` | **candidate** — the restored copy, until it is switched in |
| `ai_investment_copilot_damaged_<yyyymmdd>` | **set aside** — the former live-named database after the switch, kept |

Every SQL statement below runs through the maintenance database `postgres`
(`-d postgres`), never connected to the live-named or candidate database.
`ai-investment-copilot-db-1` is the compose container.

1. Stop the app (`next dev` / `next start`) and every other client. Never
   terminate sessions from SQL; stop the client instead. If Docker Desktop is
   unhealthy, follow the README's Docker sections first. **Before treating
   `pgdata/` as lost, rule out the README's variant 2 (silent data-mount loss):**
   the data may still be on the host disk.
2. Read-only situation check — list the databases:
   ```powershell
   'SELECT datname FROM pg_database ORDER BY 1;' | docker exec -i ai-investment-copilot-db-1 psql -X -At -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```
   If the candidate or set-aside name for today already exists (an earlier
   attempt), do not drop it: use a different suffix (for example
   `<yyyymmdd>b`) consistently in every step below.
3. **If no `ai_investment_copilot` exists at all** (it was dropped), create an
   EMPTY placeholder under the live name. This is not destructive (nothing holds
   that name) and lets the script identify the server for RestoreTest:
   ```powershell
   'CREATE DATABASE ai_investment_copilot;' | docker exec -i ai-investment-copilot-db-1 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```
   If `pgdata/` was lost, `docker compose up -d` has already created an EMPTY
   `ai_investment_copilot` (with the compose credentials) — do **not** create
   another one and do **not** drop it; it is handled in step 8 like any other
   live-named database.
4. If the live-named database holds real (possibly damaged) data and is still
   readable, take a fresh **Backup** of it first — never destroy the only copy of
   anything. (Skip this for an empty auto-created or placeholder database.)
5. Pick the newest backup; run **Verify**, then **RestoreTest** on it. Do not
   continue unless both PASS. In a disaster expect `DRIFT: DETECTED` or
   `DRIFT: UNKNOWN` (empty, damaged or unreadable live database) — drift is not
   part of the verdict. "backup is N migrations behind the repo" is not a
   failure either; bringing the restored schema up to date afterwards is a
   separate migration step that needs its own Owner approval.
6. Restore into the **candidate** (inside the container, through `postgres`).
   `CREATE DATABASE` errors out harmlessly if the name is taken:
   ```powershell
   'CREATE DATABASE ai_investment_copilot_recovered_<yyyymmdd>;' | docker exec -i ai-investment-copilot-db-1 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   docker cp <file>.dump ai-investment-copilot-db-1:/tmp/recover.dump
   docker exec ai-investment-copilot-db-1 pg_restore -U postgres -d ai_investment_copilot_recovered_<yyyymmdd> --exit-on-error --no-owner /tmp/recover.dump
   docker exec ai-investment-copilot-db-1 rm -f /tmp/recover.dump
   ```
7. **Verify the candidate before switching:** compare its per-table counts with
   the dump's `.meta.json` (the row-count query in `Get-TableCounts` in the
   script), and its `drizzle.__drizzle_migrations` with the metadata's
   `migrationLedgerHashes`. An optional spot-check by pointing a separate
   `DATABASE_URL` at the candidate is **not** read-only — the app does not enforce
   that — so only browse, change nothing.
8. **Switch** — only after step 7. First confirm that nothing is connected to
   either database (must return no rows; if it does, stop those clients and
   re-check):
   ```powershell
   "SELECT datname, count(*) FROM pg_stat_activity WHERE datname IN ('ai_investment_copilot', 'ai_investment_copilot_recovered_<yyyymmdd>') GROUP BY 1;" | docker exec -i ai-investment-copilot-db-1 psql -X -At -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```
   Then set the live-named database aside, and only if that succeeded, move the
   candidate in — two separate commands, checking each:
   ```powershell
   'ALTER DATABASE ai_investment_copilot RENAME TO ai_investment_copilot_damaged_<yyyymmdd>;' | docker exec -i ai-investment-copilot-db-1 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   'ALTER DATABASE ai_investment_copilot_recovered_<yyyymmdd> RENAME TO ai_investment_copilot;' | docker exec -i ai-investment-copilot-db-1 psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```
   PostgreSQL refuses to rename a database that has sessions, which is why the
   check above comes first. If the second rename fails, rename the set-aside
   database back to `ai_investment_copilot` before anything else.
9. Start the app. Keep `ai_investment_copilot_damaged_<yyyymmdd>` until the
   recovered database has been used successfully; removing it later is a
   separate, explicit Owner decision and is not part of this procedure.

Data written after the chosen backup is lost; the backup's `createdAtUtc` is the
recovery point.

## Still open after Unit 5 (Owner decisions)

Solved since Unit 2A: the automated schedule, the off-machine copy, encryption of
that copy and local retention (section above). Still open:

- failure notification (nothing alerts on a failed run);
- encryption at rest of the local dump files;
- RPO (acceptable data loss);
- RTO (acceptable recovery time) and a rehearsed restore on a second machine.
