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
| `npm run test` | Unit/integration tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run db:generate` | Generate a SQL migration from `src/db/schema` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly (dev convenience, skips migration files) |
| `npm run db:studio` | Open Drizzle Studio against your DB |
| `npm run db:seed` | Create/update the single investor account |

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

## Data model & architecture

`docs/architecture.md` and `docs/data-model.md` are the living reference —
keep them in sync with the code as it evolves (see the Docs Sync Rule in
`CLAUDE.md`).
