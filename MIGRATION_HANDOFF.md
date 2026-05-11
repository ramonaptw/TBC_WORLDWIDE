# TBC WORLDWIDE — Migration Handoff

**Target**: migrate from current hosting → Cloudflare Pages + Supabase.
**Status when this was written**: deployed on **Railway only**. No Netlify. No real database.

> ⚠️ **Premise correction**
> The original migration brief assumed *"Netlify + Railway"* and *"Railway Postgres → Supabase Postgres"*.
> Neither matches reality.
> - There is **no Netlify** in this project. No `netlify.toml`, no `_redirects`, no Functions.
> - There is **no Postgres**. The "database" is a single JSON file (`tbc-data.json`) on a Railway-mounted volume, accessed via a hand-rolled file-based ORM in `backend/models/database.js`.
> - "Migrating the schema" therefore means **designing a real schema for the first time**, not exporting an existing one.
>
> Read sections 3, 5, and 7 carefully before touching anything.

---

## 1. Project Summary

### Stack
- **Backend**: Node.js + Express 4. Single monolithic process serving both API and static frontend.
- **Frontend**: vanilla JS SPA (no bundler, no framework). Plain `<script>` tags, served as static files.
- **Runtime**: Node `>=18` (declared in `package.json` `engines`).
- **Lockfile**: `package-lock.json` (npm). No yarn/pnpm.
- **No build step.** No transpilation, no bundling, no minification. Source files are served as-is.

### Dependencies (`package.json`)
```
bcryptjs ^2.4.3
cors ^2.8.5
express ^4.18.2
google-auth-library ^10.6.2     (declared but UNUSED — see grep results, no require)
jsonwebtoken ^9.0.2
resend ^6.12.3
```
Dev:
```
nodemon ^3.1.0
```

### Architecture — single app, no monorepo
```
/backend
  server.js                 ← Express entry, mounts 16 /api/* routers + static frontend
  models/database.js        ← JSON-file "database" (load/save/find/insert/update/delete)
  middleware/auth.js        ← JWT auth + role guard
  lib/                      ← empty
  routes/                   ← 16 route files; see section 3
/frontend
  index.html                ← login page (root, also at /)
  app.html                  ← main SPA (served at /app and /app/*)
  reset-password.html       ← password-reset landing
  manifest.json
  css/{main.css, login.css}
  js/{api.js, app.js, utils.js}
  images/{logo.svg, icon-192, icon-512, favicon-32, apple-touch-icon}
package.json
package-lock.json
railway.toml
.env.example
.gitignore
README.md                   ← contains the single word "# Insta"
```

### Entry points and commands
- **Start (prod)**: `npm start` → `node backend/server.js`
- **Dev**: `npm run dev` → `nodemon backend/server.js`
- **Build**: none required
- **Health check**: `GET /health` → `{status:'ok', uptime}`

### Notable dependencies that affect platform choice
- **`bcryptjs`** is pure-JS (good — runs on V8 isolates / Workers, just slow). Not the native `bcrypt`.
- **`jsonwebtoken`** uses Node `crypto`. Works on Cloudflare Workers via the `nodejs_compat` flag, but cleaner to switch to `jose` for Workers.
- **`resend`** SDK — does plain HTTPS calls; works on Workers.
- **`express`** is the elephant in the room. Doesn't run on Cloudflare Pages Functions. The entire HTTP layer needs replacing (Hono is the closest swap).
- **Raw `https` module usage** in `backend/routes/leads.js` and `backend/routes/onboarding-hs.js` for HubSpot/Anthropic calls — must become `fetch` on Workers.
- **`fs.writeFileSync` + `fs.createReadStream`** in `backend/models/database.js` and `backend/routes/brand.js` — these *do not* port. Workers has no filesystem.

---

## 2. Current Netlify Setup

**There is none.** No `netlify.toml`, no `_redirects`, no `_headers`, no Functions directory, no Netlify plugins. `find` confirms the project root contains zero Netlify artifacts.

If the brief was written from a template, treat this section as not-applicable and skip ahead.

---

## 3. Current Railway Setup

### Services
**One** service: a Node web app started with `npm start`. No worker, no cron, no Redis, no separate DB service. Auto-restart on failure (max 3 retries).

### `railway.toml` (full contents)
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm start"
healthcheckPath = "/health"
healthcheckTimeout = 60
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 3
```

Nixpacks auto-detects Node, runs `npm ci`, then `npm start`. No Dockerfile.

### Database engine + version
**🚩 Loud flag.** There is **no SQL database**. The "database" is one JSON file:

```
tbc-data.json
```

…written to either `$DATA_PATH/tbc-data.json` (Railway volume mount, e.g. `/data`) or to `backend/tbc-data.json` locally. All read/write goes through `backend/models/database.js`, which:
- `load()` — reads, parses, and ensures all tables exist (silent migration of newly-added tables)
- `save(data)` — writes the entire file (~MB-scale at most) on **every mutation**
- `nextId(table)` — auto-increment via a `_counters` object

This is fine for a low-traffic internal tool but it is **not portable to Workers** (no filesystem) and **inappropriate for Supabase Postgres** without first defining a real schema.

### Schema source of truth
The schema is **implicit**: it lives in the `EMPTY` constant at `backend/models/database.js:12-20`:

```js
const EMPTY = {
  users: [], announcements: [], onboarding_steps: [],
  onboarding_progress: [], prospects: [], tasks: [], tools: [],
  commitments: [], kunden: [], wiki_articles: [], feedback: [],
  password_reset_tokens: [],
  push_subscriptions: [],          // legacy — push system was removed but table still seeded
  calllist_week: [],
  repeat_orders: [],               // legacy — feature removed but table still seeded
  _counters: {}                    // auto-increment IDs per table
};
```

Per-row shape is inferred from the route handlers that insert/update each table. There are **no migrations**, **no DDL**, **no ORM**. Several idempotent in-code "migrations" exist at the bottom of `database.js` (role renames, `kunden` backfills) — these need to be replicated as SQL or as a one-time data-import script.

**Tables** (all are JSON arrays of objects):
| Table | Used in | Notes |
|---|---|---|
| `users` | auth.js, employees.js, admin.js | bcrypt password, JWT-issued |
| `announcements` | news.js | rich-text body |
| `onboarding_steps` | onboarding.js | seeded on first run |
| `onboarding_progress` | onboarding.js | per-user completion |
| `prospects` | prospects.js | |
| `tasks` | tasks.js | has `phase_history`, checklists, due_date |
| `tools` | tools.js | seeded on first run |
| `commitments` | commitments.js | monthly targets |
| `kunden` | kunden.js | central customer record; has `service_type`, `phase_history`, `assigned_cs_user_id` |
| `wiki_articles` | wiki.js | |
| `feedback` | feedback.js | |
| `password_reset_tokens` | auth.js | sha256-hashed token + TTL |
| `push_subscriptions` | (none — legacy) | seeded but no live route writes |
| `calllist_week` | leads.js | per-user weekly calllist |
| `repeat_orders` | (none — legacy) | seeded but no live route writes |
| `_counters` | database.js | NOT a table — auto-increment registry |

### Auth tables
`users` and `password_reset_tokens`. Both are JSON-file rows. Auth flow:
1. Login: `POST /api/auth/login` → bcrypt-compare → JWT (8h expiry).
2. Domain gate: only `@thebrandingclub.com` (configurable via `ALLOWED_DOMAIN`) except `role=admin`.
3. Password reset: `POST /api/auth/password-reset/request` → creates user if absent, mails sha256-token link via Resend → `GET /verify` → `POST /confirm`.
4. JWT bearer on every `/api/*` request via `backend/middleware/auth.js`.
5. Admin promotion via `ADMIN_EMAILS` env var on every startup (database.js:126-149).

This is **fully custom auth**, deeply wired into the JSON DB. Whether to migrate to Supabase Auth is a real decision — see section 7 step 3.

### Cron / scheduled jobs
**None.** No `node-cron`, no `setInterval` for jobs, no Railway cron service. The `setTimeout` matches in grep are all per-request HTTP timeouts on outbound HubSpot calls (15s).

### Internal service-to-service networking
N/A — there is only one service. The frontend talks to the backend via same-origin `/api/*`.

### Storage volumes / persistent filesystem usage
**Critical for migration.** The app writes three things to `$DATA_PATH` (Railway volume):
1. `tbc-data.json` — the entire database
2. `brand-logo.{png,jpg,jpeg,svg,webp}` — uploaded logo (route: `backend/routes/brand.js`)
3. `brand-name.txt` — brand display name (route: `backend/routes/brand.js`)

The `brand` route streams the file back on GET (`fs.createReadStream`). On Workers, this becomes Supabase Storage / R2.

### Railway env vars (names only)
Collected via `grep -rn "process.env\." backend/`:
```
ADMIN_EMAIL
ADMIN_EMAILS
ADMIN_NAME
ADMIN_PASSWORD
ALLOWED_DOMAIN
APP_URL
CLAUDE_API_KEY        # Anthropic API key, used in backend/routes/leads.js for image analysis
DATA_PATH             # volume mount point on Railway, typically /data
HUBSPOT_API_KEY       # legacy alias
HUBSPOT_TOKEN         # primary
JWT_SECRET
PORT                  # Railway sets this
RESEND_API_KEY
RESEND_FROM
ROLE_DEFAULT_FALLBACK
```

Also accepted as legacy: `HS_TOKEN` (alias in `backend/routes/onboarding-hs.js:53`).

---

## 4. Local Dev

```bash
npm install
cp .env.example .env       # then fill in real values
npm run dev                # nodemon, hot-restart on backend changes
# open http://localhost:3000
```

There is no Vite, no devserver-proxy. The Express app serves the frontend directly from `frontend/`.

### `.env.example` (full contents)
See the file in repo root. Key vars: `JWT_SECRET`, `HUBSPOT_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_EMAILS`, `ALLOWED_DOMAIN`, `APP_URL`, `DATA_PATH`.

### Seed scripts / fixtures
There is **no separate seed script**. Seeding happens at boot in `backend/models/database.js`:
- Lines 117-124: ensures the `ADMIN_EMAIL` account exists (default `admin@tbc-deutschland.de` / `admin123`).
- Lines 134-149: ensures `ADMIN_EMAILS` are promoted to admin.
- Lines 183-200: on **first run only**, seeds 6 onboarding steps and 3 tools (Google Drive, HubSpot, Personio).
- Lines 154-180: idempotent role + kunden migrations.

---

## 5. Things That Won't Port Cleanly

Be ready: this is **not** a 1-day migration. The current backend assumes a long-lived Node process with a writable filesystem. Cloudflare Pages Functions assume neither.

### 🟥 Hard blockers
- **`fs.writeFileSync` on every DB mutation**. `database.js` rewrites `tbc-data.json` on each `insert/update/delete`. There is no equivalent on Workers. All persistence must become Supabase Postgres.
- **`fs.writeFileSync` for the uploaded logo** and `fs.createReadStream` to serve it back (`brand.js`). Must become Supabase Storage (or Cloudflare R2 / KV).
- **`brand-name.txt`**. Trivial; becomes a single Postgres row or KV entry.
- **Express**. Pages Functions don't run Express. Rewrite the HTTP layer in Hono (closest API to Express, runs on Workers).
- **Module-level in-memory cache** in `leads.js` (`const _cache = {}`). Lost on every cold start in Workers. Move to KV or accept the cache-miss cost.
- **15s HubSpot timeouts**. Pages Functions free tier has a 30s wall clock and 10 ms CPU; paid plan has 30s wall + 30s CPU. 15s outbound requests fit but leave little margin if HubSpot is slow. Worth measuring.
- **`backend/routes/leads.js` image analysis via Anthropic**. The route sends base64-encoded images up to 180 KB to Claude. Workers request body size limits apply (100 MB on paid, 1 MB on free if I recall — verify before relying on this).

### 🟧 Soft issues
- **bcryptjs** is pure JS so it *works* on Workers, but each comparison is hundreds of ms. Each login is one bcrypt call → fine. Each password-reset confirm is one bcrypt hash → fine. Don't try to brute-force-test on Workers.
- **`jsonwebtoken`** works on Workers via `nodejs_compat`, but `jose` is the idiomatic replacement.
- **`cors`** middleware: not needed once same-origin. The current setup serves frontend + API from the same origin, so CORS is a no-op anyway.
- **JWT secret rotation**. Currently a fixed env var. Existing JWTs invalidate on rotation. Document this for ops.

### 🟨 Postgres extensions
None used. The migration target is a fresh schema, no extensions to worry about.

### 🟨 Auth coupling
`backend/routes/auth.js` and `database.js` are tightly coupled to the JSON shape. If switching to Supabase Auth, **delete** these and rewire the frontend to use the Supabase JS client — it's cleaner than half-migrating.

---

## 6. Source Control Status

### `.git` directory
Present. Branches: `main`, `claude/test-qfiya` (current). Remote `origin` points to:
```
http://local_proxy@127.0.0.1:39853/git/ramonaptw/TBC_WORLDWIDE
```
That's a **local proxy URL**, not GitHub. The first migration step is to push to a real GitHub remote.

### `.gitignore` (full contents)
```
node_modules/
backend/tbc.db
backend/tbc-data.json
.env
```

This correctly excludes the DB file and `.env`. **However**, `package-lock.json` *is* tracked (correct).

### Tracked files
38 total. No `.env`, no `tbc-data.json`, no `node_modules`, no logs. Looks clean.

### Committed-secrets scan
A regex scan for `(api[_-]?key|secret|password|token)["' ]*[:=]["' ]*['"][A-Za-z0-9_-]{20,}` against `backend/`, `frontend/`, JSON, TOML, HTML returned **zero hits**. The `JWT_SECRET=tbc-deutschland-secret-2026` default in `.env.example` is a placeholder, not a live secret, but **it must be replaced in any deployed environment** — flag this to the human.

The default admin credentials `admin@tbc-deutschland.de / admin123` exist as a hard fallback in `database.js:113-115`. If `ADMIN_PASSWORD` is not set in prod env, this account exists with the literal password `admin123`. **High priority** to set a real `ADMIN_PASSWORD` (or rely entirely on `ADMIN_EMAILS` + Resend password-reset).

---

## 7. Suggested Migration Plan

Execution order matters. Don't decommission anything until step 9.

### Step 1 — Get into GitHub
**Human (web)**: create empty repo on GitHub (e.g. `ramonaptw/tbc-worldwide`). Don't initialize with README.
**Claude**:
```bash
# Audit .gitignore (already clean — confirm)
cat .gitignore
git status                          # confirm no .env, no tbc-data.json staged
git remote remove origin            # current origin is a local proxy
git remote add origin git@github.com:ramonaptw/tbc-worldwide.git
git push -u origin main
git push -u origin claude/test-qfiya
```
**Verify**: both branches visible on GitHub, no secrets leaked, no `.env`/`tbc-data.json` in the repo.

### Step 2 — Stand up Supabase
**Human (web)**: create a Supabase project. Pick a region close to users (eu-central-1 for Germany). Save the project URL, anon key, and service-role key.
**Claude**: design the Postgres schema mirroring the current JSON tables. Create one migration SQL file per table. Recommended starting layout — **don't ship this as-is, refine first**:

```sql
-- users (current shape from auth.js + database.js)
create table public.users (
  id            bigserial primary key,
  name          text not null,
  email         text unique not null,
  password      text,                                -- bcrypt hash, nullable for pre-reset accounts
  role          text not null check (role in ('admin','management','sellsupport','customersuccess','newbusiness')),
  department    text,
  position      text,
  phone         text,
  avatar        text,                                -- data: URL today, consider Storage
  instagram_session text,
  created_at    timestamptz default now(),
  updated_at    timestamptz
);

create table public.password_reset_tokens (
  id            bigserial primary key,
  user_id       bigint not null references public.users(id) on delete cascade,
  token_hash    text not null,
  expires_at    bigint not null,                     -- ms epoch — current code uses Date.now()
  used          boolean default false,
  created_at    timestamptz default now()
);
create index on public.password_reset_tokens (token_hash);

-- kunden — biggest table, has many optional columns
create table public.kunden (
  id            bigserial primary key,
  firma         text,
  telefon       text,
  kanal         text,
  abschlussdatum date,
  umsatz        numeric,
  marge         numeric,
  status        text,
  hubspot_company_id text,
  assigned_cs_user_id bigint references public.users(id),
  service_type  text,
  templates_sender text,
  handover_at   timestamptz,
  whatsapp_contact_at timestamptz,
  sla_warned_at timestamptz,
  sla_escalated_at timestamptz,
  phase_history jsonb default '[]'::jsonb,           -- array of {phase, at}
  created_at    timestamptz default now(),
  updated_at    timestamptz
);

-- tasks
create table public.tasks (
  id            bigserial primary key,
  title         text not null,
  description   text,
  status        text default 'open',                 -- 'open' | 'done'
  priority      text,                                -- 'high' | 'med' | 'low' (see badge() in app.js)
  project       text,
  kunde_id      bigint references public.kunden(id) on delete set null,
  assigned_to   bigint references public.users(id) on delete set null,
  created_by    bigint references public.users(id) on delete set null,
  due_date      date,
  checklist     jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz
);

-- ... announcements, prospects, onboarding_steps, onboarding_progress, tools,
-- commitments, wiki_articles, feedback, calllist_week
```

Don't trust this verbatim — read each route file's insert/update calls to derive the column list. Several columns are added/checked ad-hoc throughout the codebase.

**Data import**: write a one-shot Node script that reads `tbc-data.json` and `INSERT`s each row into the new tables (preserving IDs to avoid breaking foreign-keys; bump the bigserial sequence afterwards). Run it locally pointed at Supabase.

**Verify**: row counts in Supabase match `tbc-data.json` array lengths.

### Step 3 — Auth decision: Supabase Auth vs keep custom JWT

**Recommendation: keep the custom JWT flow for v1, migrate later if needed.**

Rationale:
- Custom auth is ~190 LOC (`auth.js`) and works. Replacing it is a multi-day rewrite touching every frontend call.
- Supabase Auth's domain restriction would need a Postgres function or Edge Function gate — not natively supported the way the current `ALLOWED_DOMAIN` check is.
- Resend integration for the reset link is already wired. Supabase Auth uses its own SMTP/SES; switching requires reconfiguring email templates.
- The `ADMIN_EMAILS` startup promotion is a custom idiom; replicating it on Supabase Auth = a trigger on the `auth.users` table.

If switching anyway:
- Replace `password_reset_tokens` with Supabase Auth recovery flow.
- Replace bcrypt password column with Supabase Auth's managed passwords.
- Use `supabase.auth.getUser()` server-side in each Pages Function, plus a row in a `profiles` table linked to `auth.users.id`.
- Rewire the frontend `api.js` to attach the Supabase JWT instead of the custom one.

### Step 4 — Env var migration map

| Source | Var | New location | Notes |
|---|---|---|---|
| Railway | `JWT_SECRET` | Cloudflare Pages env | Regenerate. |
| Railway | `HUBSPOT_TOKEN` | Cloudflare Pages env | Reuse as-is. |
| Railway | `RESEND_API_KEY` | Cloudflare Pages env | Reuse. |
| Railway | `RESEND_FROM` | Cloudflare Pages env | Reuse. |
| Railway | `ALLOWED_DOMAIN` | Cloudflare Pages env | Reuse. |
| Railway | `APP_URL` | Cloudflare Pages env | Update to new Pages domain. |
| Railway | `ADMIN_EMAIL` | Cloudflare Pages env | Reuse. |
| Railway | `ADMIN_PASSWORD` | Cloudflare Pages env | **Set a real one this time.** |
| Railway | `ADMIN_NAME` | Cloudflare Pages env | Reuse. |
| Railway | `ADMIN_EMAILS` | Cloudflare Pages env | Reuse. |
| Railway | `CLAUDE_API_KEY` | Cloudflare Pages env | Reuse. |
| Railway | `DATA_PATH` | — | **Drop.** Persistence is now Supabase. |
| Railway | `PORT` | — | Drop. Cloudflare manages this. |
| Railway | `ROLE_DEFAULT_FALLBACK` | Cloudflare Pages env | Optional, default `newbusiness`. |
| — | `SUPABASE_URL` | Cloudflare Pages env | **New.** |
| — | `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Pages env | **New.** Server-side only — never exposed to frontend. |
| — | `SUPABASE_ANON_KEY` | Cloudflare Pages env | **New.** Only if frontend talks to Supabase directly (it doesn't today). |

### Step 5 — Port the backend to Pages Functions

Two viable shapes. Pick one before writing code:

**Option A — Single Pages Function with Hono router (recommended)**

Create `functions/api/[[path]].ts`:
```ts
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JWT_SECRET: string;
  HUBSPOT_TOKEN: string;
  RESEND_API_KEY: string;
  // ...
};

const app = new Hono<{ Bindings: Env }>().basePath('/api');

app.post('/auth/login', async (c) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY);
  // ... mirror current auth.js logic against Supabase tables
});

// mount each existing router file here, one by one

export const onRequest = handle(app);
```
- Pros: minimal restructuring, every existing `/api/*` URL keeps working, frontend untouched.
- Cons: every request hits the same Function. Cold-start cost amortizes across all routes.

**Option B — One Pages Function per resource**

`functions/api/auth/[[path]].ts`, `functions/api/tasks/[[path]].ts`, etc. More granular cold starts, more files to maintain. Not recommended given there's no traffic justification.

Per-route porting checklist:
- `auth.js` → swap `db.findOne('users', ...)` for `supabase.from('users').select(...).single()`. Replace `crypto` and `jwt` calls with `jose` if going edge-native, or `nodejs_compat` if not.
- `kunden.js`, `tasks.js`, `prospects.js`, `feedback.js`, `wiki.js`, `commitments.js`, `news.js`, `tools.js`, `employees.js`, `onboarding.js` — bulk pattern replacement, each is small (30–200 LOC).
- `leads.js` (505 LOC) — substantial. Has raw `https` requests to Anthropic + HubSpot + Instagram. Replace with `fetch`. Drop the in-memory `_cache` or move to Cloudflare KV.
- `onboarding-hs.js` (361 LOC) — same. Lots of HubSpot CRM calls. Big enough to be its own PR.
- `admin.js` — CSV export endpoint reads from JSON DB; rewrite as Supabase SQL.
- `brand.js` (67 LOC) — uploaded-logo storage. Move to **Supabase Storage** bucket `brand` with two objects: `logo.{ext}` and `name.txt` (or move `name` to a settings row).

### Step 6 — Cloudflare Pages build config

In Cloudflare Pages project settings (web UI):
- **Build command**: leave blank (no build) OR `:` (a no-op) — there's nothing to compile.
- **Build output directory**: `frontend`
- **Root directory**: leave at project root
- **Node version**: 18 or 20 (set via `NODE_VERSION=20` env var)
- **Compatibility flags**: add `nodejs_compat` if you keep `jsonwebtoken`/`bcryptjs`. Without it, both packages will fail to load.

A `wrangler.toml` isn't strictly required for Pages, but is useful for local dev:
```toml
name = "tbc-worldwide"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "frontend"
```

Local dev with Pages Functions:
```bash
npx wrangler pages dev frontend --compatibility-flag=nodejs_compat
```

### Step 7 — DNS cutover
**Human (web)**: in Cloudflare → Pages project → Custom domains, add the production domain. Cloudflare auto-issues TLS. Once the Pages deployment is verified working at the temporary `*.pages.dev` URL, point the production CNAME/A record at Cloudflare. **Do not** switch DNS until step 8 passes.

### Step 8 — Smoke test checklist
Run against the temporary `*.pages.dev` URL (Step 7) **before** DNS cutover:

- [ ] `GET /` → login page renders, logo loads from `/api/brand/logo`
- [ ] `POST /api/auth/login` with seeded admin → returns JWT
- [ ] `GET /api/auth/me` with the JWT → returns user
- [ ] `POST /api/auth/password-reset/request` → Resend delivers email
- [ ] Reset flow end-to-end → new password works
- [ ] `GET /api/kunden` → returns the migrated rows
- [ ] Create/update a `kunde` → row persists in Supabase
- [ ] Create a task → assignment + checklist work
- [ ] `POST /api/leads` action `search` → HubSpot call succeeds under 15s
- [ ] `POST /api/onboarding-hs` action `checkLeadUrl` → returns matches
- [ ] `POST /api/brand/logo` with a small PNG → uploads to Supabase Storage
- [ ] `GET /api/brand/logo` → 200 with correct content-type
- [ ] Hard reload `/app` while logged in → SPA still authenticated
- [ ] Logout → token cleared, redirects to `/`
- [ ] Push a frontend-only change → Cloudflare auto-rebuilds in <1 min

### Step 9 — Decommission
**Do not skip the soak.** Leave Railway running for at least 7 days post-cutover. Then:

**Human (web)**:
1. Confirm zero traffic on Railway (request log = 0 for 7d).
2. Take a final `tbc-data.json` snapshot and store it offline.
3. Delete the Railway service.
4. Delete unused Resend/HubSpot/Anthropic API keys (the new ones live in Cloudflare).

**Claude**:
1. Remove `railway.toml` from the repo.
2. Remove the file-based `database.js` and any code paths that read `DATA_PATH`.
3. Update `.env.example` to the new var set.
4. Update `README.md` (currently just "# Insta") with the real onboarding instructions.

---

## 8. Open Questions

For the receiving Claude and/or the human to resolve:

1. **Real schema design** — the JSON shape is loose; some "columns" are only populated by some routes. Walk each route file once with a notepad to derive the canonical schema before writing migrations.
2. **`avatar` storage** — the `users.avatar` field is currently a `data:` URL stored inline. Move to Supabase Storage or keep inline? Inline is cheaper to ship but bloats every `/api/auth/me` response.
3. **Supabase Auth or keep custom?** — section 7 step 3 recommends keep-custom for v1. Confirm with the human before either path.
4. **Anthropic image analysis** — the `leads.js` flow uploads up to 180 KB base64 images to Claude. Verify this fits within Cloudflare Workers request-body limits for the chosen plan.
5. **HubSpot timeout headroom** — current 15s; Cloudflare Pages Functions paid plan has 30s wall. Acceptable but if HubSpot has occasional 20s+ responses (rare but observed in their docs), they'd start failing. Add a `Retry-After`-aware retry loop?
6. **Domain gate for Supabase Auth** — if switching to Supabase Auth (not the v1 plan), how to enforce `@thebrandingclub.com`? Currently it's a hard `domain === ALLOWED_DOMAIN` check in two route handlers. Supabase needs either a webhook on signup or a Postgres trigger on `auth.users`.
7. **Local dev story post-migration** — `npx wrangler pages dev` works but is slower than `nodemon`. Decide whether the team accepts that, or whether to keep a parallel Express dev runner during the transition.
8. **`backend/tbc.db`** in `.gitignore` — relic of an earlier SQLite attempt? Confirm it's not in use anywhere (grep says no), then remove from `.gitignore` after migration.
9. **`_counters` migration** — when porting `tbc-data.json` to Postgres, you need to set each table's `bigserial` sequence to `MAX(id) + 1` from the JSON, or new inserts will collide with imported IDs.
10. **In-flight branch** — work is happening on `claude/test-qfiya`. Decide whether to merge to `main` before migration or migrate the branch and merge after.
