# PCT Project Desk (PostgreSQL)

A private, single-owner CRM for tracking company writing projects by a manually
assigned **PCT / project number**. It keeps the student, writer, deadlines,
progress, student/writer payments and revision requests for every project, with
dashboards, filters, search, Excel reporting, JSON backup/restore and a
PostgreSQL database as the only production data store.

Built with the Next.js App Router, TypeScript, React, Tailwind CSS and
`node-postgres` (`pg`).

---

## 1. Requirements

| Requirement | Notes |
| --- | --- |
| Node.js | 20 LTS or newer (22 recommended) |
| PostgreSQL | 14 or newer — local, Docker, or a managed cloud database |
| Docker (optional) | Only if you want to run PostgreSQL/app in containers |

The build (`npm run build`) does **not** need a database. Connections are
created lazily at request time, so a missing database produces a clear setup
screen instead of a broken build.

---

## 2. Quick start (local PostgreSQL)

```bash
# 1. Install dependencies
npm install

# 2. Create a database and role (run as a PostgreSQL superuser)
#    Using psql:
#      CREATE ROLE pct LOGIN PASSWORD 'choose-a-strong-password';
#      CREATE DATABASE pct_crm OWNER pct;
#    Or the shell helper:
#      createdb pct_crm

# 3. Prepare environment + owner password
cp .env.example .env      # then edit DATABASE_URL / APP_ORIGIN
npm run setup             # keeps existing values; generates the password hash once

# 4. Create the schema
npm run migrate

# 5. Run it
npm run dev               # http://localhost:3000
# or
npm run build && npm start
```

Open `http://localhost:3000`, sign in with the owner password, then press
**New project**.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Server-only PostgreSQL connection string. **Never** prefix it with `NEXT_PUBLIC_`. |
| `APP_ORIGIN` | yes | Exact public origin (scheme + host + port, no trailing slash). Used for same-origin/CSRF checks. |
| `ADMIN_PASSWORD_HASH` | yes | Salted scrypt hash of the owner password. Changing it invalidates all sessions. |
| `PG_POOL_MAX` | no | Pool size, default `10`, capped at `50`. |
| `PCT_PG_SSL_CA` | no | Path to a PEM CA bundle for private-CA hosted databases (TLS verification stays on). |

`.env` is git-ignored; only `.env.example` is committed. Credentials are never
sent to the browser, logged, or included in backups.

### `npm run setup`

`npm run setup` preserves whatever is already in `.env`:

- creates `.env` from `.env.example` **only** when it does not exist;
- generates a random owner password **only** when `ADMIN_PASSWORD_HASH` is
  missing or empty, prints it once, and never silently replaces an existing
  password or `DATABASE_URL`;
- reminds you of the remaining steps (`npm run migrate`, `npm run dev`).

---

## 3. PostgreSQL connection options

### Local PostgreSQL in Docker

```bash
# .env (Compose also reads this file)
POSTGRES_PASSWORD=choose-a-strong-db-password
ADMIN_PASSWORD_HASH=<node scripts/hash-password.mjs 'your-password'>
APP_ORIGIN=http://localhost:3000

docker compose up -d db        # database only, healthcheck included
DATABASE_URL=postgresql://pct:choose-a-strong-db-password@localhost:5432/pct_crm npm run migrate
npm run dev                    # app on the host talking to the container
```

The Compose database is **not published to the host by default** — uncomment
the `ports:` block in `docker-compose.yml` if you want to connect with `psql` or
a GUI client. Data lives in the named volume `pct_pgdata`.

### Whole stack in Docker (app + database)

```bash
docker compose up --build      # app: http://localhost:3000, db internal only
```

The app container runs `npm run migrate` before `npm start`, waits for the
database healthcheck, and stores data in the `pct_pgdata` volume. The database
is reachable only on the internal Compose network.

### Managed cloud PostgreSQL (Neon, Supabase, RDS, Aiven, …)

1. Create the database in the provider's dashboard (**cloud account,
   credentials and any hosting costs are your setup — nothing is provisioned
   for you and no free plan is guaranteed to be permanent**).
2. Put the provider's connection string in `.env`, asking for TLS:

   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=verify-full
   # or, when the server uses a private CA:
   # DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME?sslmode=verify-ca
   # PCT_PG_SSL_CA=/absolute/path/to/ca.pem
   ```

3. `npm run migrate`, then `npm run dev` / `npm run build && npm start`.

TLS rules enforced by the app (`lib/db.ts`):

- `sslmode=verify-full` → TLS with full certificate verification;
- `sslmode=verify-ca` → TLS, certificate signature verified against
  `PCT_PG_SSL_CA` (or the system store);
- no `sslmode` and a **non-local** host → TLS with certificate verification by
  default;
- `sslmode=disable` / local hosts → plain connection. Certificate verification
  is never disabled globally.

### HTTPS

Set `APP_ORIGIN=https://crm.example.com` behind a TLS-terminating reverse proxy
(nginx, Caddy, Traefik, or your host's load balancer). Session cookies become
`Secure` automatically; in production, terminate TLS at the proxy and forward
`X-Forwarded-For` so login throttling sees real client addresses.
`npm start` serves plain HTTP on port 3000 — do not expose it directly to the
internet without TLS.

---

## 4. Migrations

Versioned SQL files live in `db/migrations/` and are applied once each inside a
transaction, tracked in `schema_migrations`, serialized by a PostgreSQL advisory
lock:

```bash
npm run migrate
```

The app also applies pending migrations lazily on first database use, so
`npm run dev` works right after `npm install`; `npm run migrate` remains the
explicit production command (and is what the Docker image runs at start-up).

---

## 5. Data model (summary)

| Object | Purpose |
| --- | --- |
| `projects` | One row per PCT record: `number` (unique, trimmed/uppercased), `title`, `student`, `phone` (text — leading zeros preserved), `university`, `writer`, `words`, `received`, `due` (date-only), `status`, `percent`, `pending`, `notes`, `total`, `paid`, `writer_total`, `writer_paid` (`numeric(14,2)` — exact money), `revision` (optimistic-lock counter). |
| `project_revisions` | Revision requests, `1:n` with `projects`, ordered by `position`. |
| `sessions` | SHA-256 hashes of random session tokens, expiry, auth fingerprint (revokes sessions when the password changes). |
| `login_attempts` | Atomic sign-in throttle counters (10 per 15 minutes). |
| `schema_migrations` | Applied migration bookkeeping. |

Dates are `date` columns and travel as `YYYY-MM-DD` strings end to end, so they
never shift through UTC. Business-day rules use **Asia/Kolkata**.

---

## 6. Features

### Projects
- Manual entry of the PCT / project number received in the WhatsApp group (no
  WhatsApp integration is involved).
- Every field from the original record: number, title, student, phone,
  university, writer, words, received, due, status, completion, pending work,
  notes, student fee/paid, writer fee/paid and revision requests.
- Statuses exactly: `Not started`, `In progress`, `On hold`, `Completed`,
  `Delivered`. Choosing Completed/Delivered forces 100 % (enforced on the
  server too).
- Optimistic locking: each save increments the record version; a stale save
  returns **409** with a “changed in another tab” message instead of
  overwriting.
- Project fields and revision requests are written atomically in one
  transaction.

### Dashboard (India time)
Clickable cards, each mapping to a filter:

| Card | Rule |
| --- | --- |
| Active projects | status is anything except `Delivered` |
| Due in 2 days | active, due today, tomorrow or the day after (calendar days) |
| Overdue | active, submission date before today |
| Payment pending | total outstanding student balance + number of projects owing |
| Writer payments pending | total outstanding writer balance |
| Open revisions | total number of open revision requests (not projects) |

The current day is refreshed while the page stays open.

### Search, filters, register
- Partial, case-insensitive search over PCT number, student, writer, phone,
  university and title, combined with the selected filter.
- Eight filters with whole-register counts: All projects, Due in 2 days,
  Overdue, Pending work, Completed (Completed + Delivered), Payment pending,
  Writer payment pending, Open revisions.
- Register rows show PCT number (clickable), title, student, university, writer,
  submission date + deadline label, status, progress bar and %, pending work,
  open-revision count with overdue/due-today indication, student balance/fee,
  writer balance/fee and an Open record button; mobile uses cards.
- Manual refresh, loading skeletons, load-error retry, first-project and
  no-matches empty states, Clear filters, saving/disabled states,
  success/error notifications, and entered values kept after a failed save.

### Payments
Separate **Student payment** and **Writer payment** sections per record;
remaining = fee − paid. Cumulative totals remain editable (this is the existing
payment model — not a transaction ledger). Fully settled and zero fees are
supported.

### Revisions
Up to 200 requests per project in a preserved order, each with id, description,
requested date, deadline (on/after the request date), status
(`Requested`, `In progress`, `Completed`) and notes. Open requests stay open —
and keep showing in Pending work / Open revisions — even after the parent
project is delivered. Completing a project never silently completes its
revisions.

### Export, backup and restore
- **Export Excel** — a real `.xlsx` workbook (ExcelJS), with a `Projects` sheet
  (22 columns: Project ID … Record version) and a `Revisions` sheet, frozen
  header row, auto-filters, numeric money cells, text-safe values (leading `=`,
  `+`, `-`, `@` are neutralised) and preserved leading-zero phone numbers.
  Exports every saved project regardless of the current search/filter.
- **Download full backup** — JSON v1 (`format: "pct-project-desk"`,
  `version: 1`, `exportedAt`, `currency: "INR"`, `timezone: "Asia/Kolkata"`,
  `projects`). Contains only business data — never session tokens, password
  hashes, credentials or login-attempt records.
- **Import JSON backup** — accepts the v1 backups from the SQLite edition and
  the earlier hosted CRM (missing writer/payment/revision fields get their
  empty/zero defaults, restored record versions start at ≥ 1). 20 MB limit,
  full validation, duplicate id/PCT rejection, and import **only into an empty
  register**. All records are inserted in one transaction or none; a nonempty
  register is refused without changing anything. Excel is a reporting format,
  not a restore format.

### Authentication
Single-owner password login with salted scrypt hashing and timing-safe
verification. Session tokens are random; only their hashes are stored. Cookies
are `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, and sessions expire after
8 hours, are invalidated server-side on sign-out and automatically revoked when
`ADMIN_PASSWORD_HASH` changes. Sign-in is throttled atomically at 10 attempts
per 15 minutes. Sign-in and write requests are rejected when they come from a
cross-site origin, and every projects/export/restore API requires a session.

---

## 7. Tests

```bash
npm run typecheck                 # TypeScript
npm test                          # unit + integration
```

Integration tests need a **dedicated PostgreSQL test database** — never a
production one. Point `TEST_DATABASE_URL` at it (its name must contain `test`);
the suite drops and recreates the `public` schema in that database only and
skips cleanly when the variable is missing:

```bash
createdb pct_crm_test
TEST_DATABASE_URL=postgresql://pct:password@localhost:5432/pct_crm_test npm test
```

What is covered: validation rules, IST calendar-day boundaries, all eight
filters and search across every supported field, create/update/reopen,
normalized duplicate-PCT rejection (409), stale-update conflicts (409), atomic
project+revision saves, open revisions after delivery, student/writer balance
and overpayment rejection, real `.xlsx` output, v1 JSON round-trip with ids and
phone strings preserved, empty-only transactional import, unauthenticated API
rejection, origin protection, login throttling, session expiry and logout, and
record survival across a pool/restart cycle.

---

## 8. Database backup and restore (PostgreSQL-native)

Manual JSON backups are the app-level mechanism; use PostgreSQL's own tools for
infrastructure-level backups too:

```bash
# Dump (custom format)
pg_dump --format=custom --no-owner --dbname "$DATABASE_URL" > pct-crm-$(date +%F).dump

# Restore into a fresh database
createdb pct_crm_restore
pg_restore --no-owner --dbname "postgresql://…/pct_crm_restore" pct-crm-2026-01-01.dump
```

Backups remain **manual** — no scheduled backup system is included.

---

## 9. Password reset

```bash
node scripts/hash-password.mjs 'new-strong-password'
# put the printed value into ADMIN_PASSWORD_HASH in .env, then restart the app
```

All existing sessions are invalidated immediately (the auth fingerprint stored
on each session no longer matches). Stored project data is unaffected.

---

## 10. Migrating from the earlier SQLite edition

Preferred path — no live system is switched automatically and the old database
is left untouched:

1. Take a **full JSON backup** from the old edition.
2. Create a **new, empty** PostgreSQL database, set `DATABASE_URL`, run
   `npm run migrate`.
3. Sign in to this app and use **Import JSON backup**, or POST the file to
   `/api/restore`.
4. Verify against the runbook: **`docs/migration-runbook.md`**.

`node:sqlite` is **not** part of the runtime code — PostgreSQL is the only
database. No SQLite/D1 wrapper or disabled feature remains.

---

## 11. Feature-parity checklist

| # | Feature | Status |
| --- | --- | --- |
| 1 | Next.js App Router + TypeScript + React + Tailwind; `dev`, `build`, `start` | ✅ |
| 2 | PostgreSQL as sole store; `pg` pool, parameterized SQL, versioned migrations | ✅ |
| 3 | `DATABASE_URL` server-only; lazy connections; build without a database | ✅ |
| 4 | Transactions on one client, rollback + release in `finally` | ✅ |
| 5 | Local and hosted PostgreSQL with proper TLS verification | ✅ |
| 6 | New project button, first-project empty state, clickable PCT number, open-record button | ✅ |
| 7 | Editable dialog with Save project / Cancel; all record fields retained | ✅ |
| 8 | Statuses exactly Not started / In progress / On hold / Completed / Delivered | ✅ |
| 9 | Completion 0–100, numeric + progress bar, auto-100 for Completed/Delivered | ✅ |
| 10 | Server-side validation of all rules and limits (text, dates, words, money, revisions) | ✅ |
| 11 | Exact numeric money storage, INR formatting to two decimals | ✅ |
| 12 | IST business days; date-only values never shift through UTC | ✅ |
| 13 | Clickable summary cards (active, due in 2 days, overdue, payments, writer payments, open revisions) | ✅ |
| 14 | Deadline labels: today, tomorrow, future days, days overdue, Delivered | ✅ |
| 15 | Partial case-insensitive search over all six supported fields | ✅ |
| 16 | Eight filters with whole-register counts and card-to-filter navigation | ✅ |
| 17 | Register columns incl. pending work, revision count, balances and overdue/today flags | ✅ |
| 18 | Manual refresh, skeletons, retry, empty/no-match states, Clear filters, notifications, values kept on failure | ✅ |
| 19 | Student and writer payment sections with remaining balances and dashboard totals | ✅ |
| 20 | Up to 200 ordered revision requests with all fields and deadline labels | ✅ |
| 21 | Open revisions stay visible after delivery; project completion does not complete them | ✅ |
| 22 | Real `.xlsx` export with two sheets, frozen header, filters, text safety | ✅ |
| 23 | JSON v1 backup/restore with ID/PCT/phone preservation; backup excludes secrets | ✅ |
| 24 | Empty-only import in one transaction, 20 MB limit, duplicate rejection | ✅ |
| 25 | Password login, session hashing, 8-hour expiry, cookies, server-side logout | ✅ |
| 26 | 10-attempts/15-minutes atomic throttle; origin (CSRF) protection | ✅ |
| 27 | Sessions/login attempts in PostgreSQL; password change invalidates sessions | ✅ |
| 28 | Optimistic locking with 409 on stale updates; atomic project+revision saves | ✅ |
| 29 | Database-level PCT uniqueness with the same trim/uppercase normalization | ✅ |
| 30 | Existing API contracts: `/api/projects`, `/api/export`, `/api/restore`, `/api/auth/*` | ✅ |
| 31 | `.env.example`, `.gitignore`, `npm run setup` that preserves settings | ✅ |
| 32 | Dockerfile + Compose with persistent volume, healthcheck, private database | ✅ |
| 33 | README, migration runbook, integration tests against PostgreSQL | ✅ |

### Intentionally not included

Not requested and not implemented (do not expect these): file attachments,
automatic WhatsApp messages or a WhatsApp connection, scheduled notifications or
reminders, multi-user roles/permissions, staff/student/writer portals, public
registration, automatic scheduled backups, and transaction-ledger payments
(the cumulative fee/paid model above is the payment record).

---

## 12. What the owner must supply

- A PostgreSQL database (local, Docker, or a paid/managed cloud instance) and
  its connection string in `DATABASE_URL`.
- The owner password, hashed into `ADMIN_PASSWORD_HASH`.
- The public `APP_ORIGIN` and TLS termination for production.
- Cloud provider account, credentials and any hosting costs — nothing is
  provisioned or deployed for you, and connection attempts to a database that
  does not exist yet are reported as a setup requirement rather than faked.

## 13. Scripts reference

| Command | Purpose |
| --- | --- |
| `npm run setup` | Create/refresh `.env` without overwriting existing secrets |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run dev` | Next.js development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit + integration tests (`TEST_DATABASE_URL`) |
| `node scripts/hash-password.mjs 'pw'` | Generate `ADMIN_PASSWORD_HASH` |
