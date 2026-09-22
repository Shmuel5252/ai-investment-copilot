# AI Investment Copilot

A personal AI copilot that learns how you invest — not what to buy. See
`investment_ai_product_concept_he_v2.md` for the full product concept, and
`CLAUDE.md` for the operating manual (scope, principles, architecture).

## Local setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Environment variables** — copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — defaults to the local Docker Postgres below; swap for
     a Neon connection string for anything beyond local dev.
   - `ANTHROPIC_API_KEY` — get one at https://console.anthropic.com
   - `FMP_API_KEY` — get one at https://financialmodelingprep.com (free tier)
   - `SESSION_SECRET` — generate with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

3. **Start local Postgres** (requires Docker Desktop running)
   ```
   docker compose up -d
   ```

4. **Run migrations**
   ```
   npm run db:migrate
   ```

5. **Create your investor account** (single-user product, no signup flow)
   ```
   SEED_INVESTOR_EMAIL=you@example.com SEED_INVESTOR_PASSWORD=yourpassword npm run db:seed
   ```

6. **Run the app**
   ```
   npm run dev
   ```
   Visit http://localhost:3000 and sign in.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | All tests (Vitest). DB-backed tests need `TEST_DATABASE_URL` (see "Testing") and fail closed without it |
| `npm run test:unit` | Pure unit tests only — no database needed |
| `npm run db:test:create` | Create an authorized, empty test database (`-- <name>` optional) |
| `npm run db:test:drop` | Drop a test database — refuses anything without the test marker (`-- <name>`) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run db:generate` | Generate a SQL migration from `src/db/schema` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly (dev convenience, skips migration files) |
| `npm run db:studio` | Open Drizzle Studio against your DB |
| `npm run db:seed` | Create/update the single investor account |

## Testing

DB-backed tests (`tests/integration/**`) create synthetic investors and write to
insert-only history tables, so they can **never** run against your real
database. They run only against a database created for tests:

1. `npm run db:test:create` — creates an empty database and marks it (a
   marker in the database's own metadata; the name means nothing).
2. Set `TEST_DATABASE_URL` (env or `.env`) to your `DATABASE_URL` with that
   database's name.
3. `npm test` — pending migrations are applied to the test database
   automatically; the application `DATABASE_URL` is never used.

Without `TEST_DATABASE_URL`, unit tests still run and DB-backed tests **fail
before writing anything**. A `TEST_DATABASE_URL` that points at the same
database as `DATABASE_URL`, or at a database without the marker, aborts the
run. Error messages never contain connection strings. Details:
`tests/support/test-database.ts`.

## Resolved environment issue: OneDrive + node_modules

The project used to live at `OneDrive\Desktop\ai-investment-copilot`. OneDrive
tried to sync/index every file under `node_modules` (tens of thousands of
small files) and `.next` (constantly-changing build output), which caused
real, occasionally severe CPU contention — observed firsthand as a single
`bcrypt.hash()` test taking 14+ minutes under load, with no code-level cause.
`.gitignore` keeps these out of git, but OneDrive syncs the working tree
regardless of `.gitignore`.

**Fixed:** the project now lives at `C:\dev\ai-investment-copilot`, outside
any OneDrive-synced folder — rely on git/GitHub for backup instead of
OneDrive. `vitest.config.ts` still keeps a generous `testTimeout` as a
low-cost safety margin; if tests ever hang or slow down for no
apparent reason, this is almost certainly why.

## Known gotcha: FMP free-tier plan restricts `quote`/`ratios-ttm` to a symbol whitelist

Checked live against the real key in this project's `.env` while building
Idea → Investment Case: FMP's `/stable/quote` and `/stable/ratios-ttm`
endpoints return HTTP 402 ("Premium Query Parameter... not available under
your current subscription") for any ticker outside a small whitelist of
well-known large caps (AAPL/MSFT/NVDA/TSLA/PLTR/KO all worked; IBM/GME/SNOW
and an invalid ticker all 402'd) — not a normal empty-result response.
`/stable/profile` had no such restriction for any real ticker tried.
`src/lib/market/fmp.ts` treats `profile` as the required source and
`ratios-ttm` as best-effort (silently omitted, `valuationRatiosAvailable:
false`, never a fabricated fallback, when the plan blocks it for that
ticker) — see that file's top comment for the full reasoning. If FMP's
plan/whitelist changes, that's the one file to revisit.

## Known gotcha: Docker Desktop stops itself in the background (variant 1 — daemon down, connection refused)

Happened repeatedly during development (not a one-off): Docker Desktop —
and with it the local Postgres container — goes down on its own with no
visible warning, while `npm run dev` keeps running against it. Every
DB-touching request then fails, including totally unrelated-looking ones
(`auth.me` on a fresh page load, `ideas.create`, anything) — it's not
specific to whatever feature you were actually testing.

**The tell:** the error is a bare `Failed query: insert/select ...` with
**no `code`, `detail`, or `hint`** anywhere in it, even when you inspect
the full `.cause` chain. That absence is the diagnostic signal, not a
sign of a hidden/truncated real error — a genuine Postgres-side error
(a constraint violation, a bad column, etc.) always carries a SQLSTATE
`code` plus usually `detail`/`hint`, because Postgres itself generated
those. A connection refusal (`ECONNREFUSED`) never reaches Postgres at
all, so those fields simply don't exist for it — confirmed by
reproducing the exact failure and inspecting the full error object, not
assumed.

**Before investigating a "Failed query" error as an app bug**, check
`docker ps` (or just `docker compose up -d` — harmless if it's already
up) first. Costs ten seconds; skipping it has cost real investigation
time more than once chasing a code-level explanation for what was
actually an infrastructure hiccup.

## Known gotcha: Docker Desktop stops itself in the background (variant 2 — silent data-mount loss, `docker ps` looks fine)

A second, different failure mode under the same root instability, worth
its own diagnostic tag because the tell is the *opposite* of variant 1
above: `docker ps` reports the container `Up` the whole time (most
likely Docker Desktop's WSL2 host-filesystem passthrough going stale,
plausibly after the host slept — not confirmed which layer specifically
broke, only the symptom), so the "check `docker ps` first" advice from
variant 1 doesn't catch it. The container process stays alive but can no
longer read its own data directory.

**The tell:** every query fails with a bare `Failed query: ...` whose
`.cause` bottoms out in a real Postgres-side `FATAL`/`PostgresError` —
**not** `ECONNREFUSED` — with a message like `could not open file
"global/pg_filenode.map": I/O error`. `docker logs <container>` shows
the same line repeating once a minute indefinitely once it starts.

**Recovery:** a plain `docker compose restart` (or `down` + `up -d`) is
not enough — it fails outright with `error while creating mount source
path ... file exists`, since the mount problem lives at the Docker
Desktop level, not the container's. Fully quit Docker Desktop (kill
`Docker Desktop.exe` and its `com.docker.*` helper processes if it
doesn't exit cleanly) and relaunch it fresh; wait for `docker info` to
succeed before touching the container again. On the next container
start, Postgres's own crash recovery runs automatically (`database
system was interrupted... automatic recovery in progress`) and this is
the normal, safe path back — but confirm real data survived by actually
querying something afterward (row counts, a known value) rather than
trusting the recovery log alone; a `redo`/checkpoint completing without
error is reassuring but isn't the same as verifying nothing from the
last few seconds before the crash was lost.

## Data model & architecture

`docs/architecture.md` and `docs/data-model.md` are the living reference —
keep them in sync with the code as it evolves (see the Docs Sync Rule in
`CLAUDE.md`).
