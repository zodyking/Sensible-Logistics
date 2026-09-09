# Yard Manager

Mobile-first yard and custody app for one drayage company. Drivers pick up and drop off containers, park boxes on a yard map, and keep a short-haul time record. Admins manage the pool, drivers, locations, and documents.

This repository is the Sensible Logistics deployment of that app (Nuxt 4 PWA, PostgreSQL, Dokploy). The brand bar uses `NUXT_PUBLIC_APP_NAME` (defaults to **Yard Manager**).

---

## What it does

**Drivers** (bottom tabs: Home · Trips · Tasks · Containers · More)

- Start a pickup or customer swap, hang a chassis, capture load/empty and a seal, then confirm into custody.
- Arrive, keep or detach the chassis, and drop off. Home shows the live trip plus SMS, contacts, and documents.
- Inventory by location: add a box or chassis already on site (a **Load** requires a seal), edit, move, or open the yard map.
- Photograph a container/chassis number (OpenOCR runs in the app image, not in the browser).
- Tasks from inbound SMS, plus the FMCSA §395.1(e)(1) short-haul timecard.
- Optional **Check CSX** on a container (public ShipCSX lookup in Chromium — no booking).

**Admins** land on `/admin/containers` (there is no admin dashboard). Same operational data, denser tables, plus settings and email-delivery test.

Every mutating movement takes a client-generated event UUID so a retry cannot double-post custody.

---

## Quick start

Needs **Node.js 22+** and **PostgreSQL 14+** (no extensions). The app does not start Postgres.

```bash
cp .env.example .env
# Set NUXT_SESSION_PASSWORD (32+ chars) and DATABASE_URL.
# SMTP can stay empty in development — the verification link is printed to the console.

# Example local database:
#   docker run -d --name ct-db -p 5432:5432 \
#     -e POSTGRES_USER=tracker -e POSTGRES_PASSWORD=tracker \
#     -e POSTGRES_DB=container_tracker postgres:17
#   DATABASE_URL=postgresql://tracker:tracker@localhost:5432/container_tracker

npm install --legacy-peer-deps --no-audit --no-fund
npm run db:migrate
npm run db:seed
npm run dev                          # http://localhost:3000
```

`--legacy-peer-deps` is required: npm 10 fails Nuxt 4.5’s optional peer tree without it (`Cannot read properties of null (reading 'edgesOut')`).

### Seed logins

| Role | Email | Password | Opens |
| --- | --- | --- | --- |
| Admin | `admin@sensible.test` | `Password123!` | `/admin/containers` |
| Driver | `driver@sensible.test` | `Password123!` | `/` |

Invite code for `/signup` is `NUXT_COMPANY_INVITE_CODE` (seed default **`SENSIBLE`**). The seed is idempotent. Do not use these accounts in production.

```bash
npm run lint          # ESLint
npm run test          # Vitest
npm run build         # Production bundle → .output/
```

---

## Stack

Exact pins from `package.json`:

| | Version |
| --- | --- |
| Nuxt / Vue / Vue Router | 4.5.2 / 3.5.41 / 4.6.3 |
| Drizzle ORM / `pg` / Zod | 0.45.2 / 8.23.0 / 4.4.3 |
| `nuxt-auth-utils` | 0.5.30 |
| Tailwind CSS | 4.3.3 |
| Leaflet / Konva / Playwright | maps, yard canvas, ShipCSX Chromium |
| Node (Docker) | 22 (`node:22-alpine` build, `node:22-bookworm-slim` run) |
| PostgreSQL | 14+ external — `DATABASE_URL` |
| Object storage | SeaweedFS S3 API in Compose (`chrislusf/seaweedfs`) |

---

## How the app is laid out

```
app/pages/
  index.vue                 Driver home
  pickups/  trips/          New pickup, attach, live trip, drop-off
  tasks/    timecard/       SMS tasks + short-haul time record
  containers/               Location inventory (tab) + container detail / edit / move / ShipCSX
  locations/                Sites, add equipment, yard map, CSX empty list
  chassis/                  Chassis record
  more.vue  settings.vue    Account; operator tools behind a system code
  admin/                    Containers, drivers, locations, documents, settings
server/
  api/                      Auth, movements, locations, yard, tasks, ShipCSX, health
  services/                 Pool, events, placements, OCR, mail, ShipCSX, Quo
  database/                 Drizzle schema + seed
shared/utils/               ISO 6346, domain vocabulary, pickup/add steps
drizzle/                    SQL migrations
docker/                     Entrypoint + migrator
```

Driver **Containers** is the location list (`/containers` → `/locations/:id`). A container record is `/containers/:id`.

---

## Environment

Copy `.env.example`. The keys that must be set in production:

| Variable | Purpose |
| --- | --- |
| `NUXT_APP_URL` | Public origin, no trailing slash (email links) |
| `NUXT_SESSION_PASSWORD` | Session cookie seal, 32+ characters |
| `NUXT_COMPANY_INVITE_CODE` | Shared driver signup code |
| `DATABASE_URL` | Postgres connection string |
| `NUXT_SMTP_HOST` (+ port / user / password) | Verification email |

Useful optionals:

| Variable | Purpose |
| --- | --- |
| `NUXT_PUBLIC_APP_NAME` | Brand bar and titles (PWA name is build-time) |
| `NUXT_COMPANY_NAME` / `LEGAL_NAME` / `USDOT_NUMBER` | UI + DOT time record |
| `NUXT_COMPANY_TIMEZONE` / `CYCLE_TYPE` | Timecard day and 70/8 vs 60/7 |
| `NUXT_DATABASE_SSL` | `true` for managed Postgres TLS |
| `PORT` | `3847` in Docker (not 3000 — Dokploy’s panel) |
| `NUXT_S3_*` | SeaweedFS in Compose (not Amazon) |
| `NUXT_SHIPCSX_DEFAULT_TERMINAL` | Fallback CSX terminal (e.g. `North Bergen`) |
| `NUXT_SHIPCSX_POLL` | `true` to poll ShipCSX on a schedule |
| `NUXT_PUBLIC_MAP_TILES_URL` / `GEOCODER_URL` | Self-hosted tiles / Nominatim |

`openssl rand -base64 32` for a session secret. Unprefixed `SMTP_*` aliases still work.

### Email and signup

1. Driver submits `/signup` with the invite code. No session until the address is confirmed.
2. A 24-hour single-use link is emailed (SHA-256 stored, resend throttled).
3. Production with empty `NUXT_SMTP_HOST` refuses signup. Development prints the link.
4. **Admin → Settings → Email delivery** (or `POST /api/admin/smtp-test`) reports the mail server’s own error.

Phone can be verified when Quo SMS is configured. Matching the invite code ignores case, spaces, and dashes. Rotate the code by changing the env var and redeploying — existing accounts stay.

On first boot the company row is created from these variables, so production does not need the demo seed.

---

## Optional connections

Unlocked from **More** with a system code (not listed in the UI):

- **API connections** — Quo SMS (inbound tasks, trip texts, phone verify).
- **Clear records** — typed data reset for a demo company.

**ShipCSX** does not use that screen. Check CSX on a container (or a location) drives Chromium against the public shipment lookup, writes the snapshot to Postgres, and never books a reservation. Production images install Chromium after the Nitro build. Locally: `npx playwright install chromium` if lookups fail.

Maps use Leaflet. Street tiles default to OpenStreetMap; yard setup can use Esri imagery. Point `NUXT_PUBLIC_MAP_TILES_URL` at your own PMTiles when you do not want public tile servers. Address search uses Photon unless `NUXT_PUBLIC_GEOCODER_URL` is set.

---

## Deploy (Dokploy)

1. Create **Postgres** outside this compose file. Copy `DATABASE_URL`. Stock 14+ is enough — coordinates are numerics and GeoJSON, not PostGIS.
2. Add a **Compose** app from this repo. It builds `app` and starts `seaweedfs`. It does not start a database.
3. Paste env from `.env.example`. Minimum: `NUXT_SESSION_PASSWORD`, `DATABASE_URL`, `NUXT_APP_URL`, `NUXT_COMPANY_INVITE_CODE`, SMTP.
4. Domain → service `app`, **container port 3847**. Do not publish host 3000. Do not publish SeaweedFS.
5. Deploy. The entrypoint migrates, then starts Nitro. `HEALTHCHECK` hits `/api/health` (database must be up; mail/OCR/storage are degraded, not fatal).
6. Confirm mail from **Admin → Settings → Email delivery**. Seed only on a demo box.

OCR models and Playwright Chromium are installed in the Debian runner image. Set `SKIP_MIGRATIONS=true` only if you migrate some other way.

---

## Still incomplete

| Area | Today |
| --- | --- |
| Object storage | Interface + validation in `server/services/storage.ts`. SeaweedFS is in Compose; the S3 client is not wired (`501` until `NUXT_S3_*` is implemented). |
| Offline outbox | Idempotent APIs are ready. Dexie/IndexedDB queue is not. The Synced pill is a placeholder. |
| Time-record PDF | Print-optimized HTML. Playwright PDF export is not on this path. |
| Maps in locked-down networks | Works with public OSM/Esri unless you set `NUXT_PUBLIC_MAP_TILES_URL`. |

---

## Scripts

| Script | |
| --- | --- |
| `npm run dev` / `build` / `preview` | Dev server, production build, serve `.output/` |
| `npm run lint` / `lint:fix` | ESLint (`@nuxt/eslint`, stylistic) |
| `npm run test` / `test:watch` | Vitest |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` / `db:seed` | Drizzle |

---

## Design

Industrial operations console: navy chrome, amber primary actions, paper surfaces, monospace equipment numbers. Tokens live in `app/assets/css/main.css` (Tailwind v4 `@theme`).

Driver shell: fixed brand bar, scrolling column (~520 px), five-tab bar with a raised Tasks control, 44 px+ targets, status chips that always include a label (not color alone). Admin: drawer on small screens, sticky left nav on desktop.
