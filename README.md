# Yard Manager

PWA for one drayage company: track containers and chassis from pickup through the yard to drop-off.

The brand bar uses `NUXT_PUBLIC_APP_NAME` (default **Yard Manager**). This repo is the Sensible Logistics deployment.

---

## Features

Driver tabs: **Home · Trips · Tasks · Containers · More**

| | |
| --- | --- |
| **Trips** | New pickup or customer swap. ISO container numbers, chassis hang, empty/load, seal on a load, confirm into custody. Arrive and drop off; keep or detach the chassis. |
| **Home** | The live trip, plus SMS, contacts, and documents for that movement. |
| **Yard** | Locations with occupancy. Add a box or chassis already on site (a load needs a seal). Yard map, move between sites, chassis records. |
| **Scan** | Photograph the container and chassis; OpenOCR runs in the app image. |
| **CSX** | Check CSX on a container or location. Public ShipCSX lookup in Chromium — snapshots only, never a reservation. |
| **Tasks** | Dispatch list, including work created from inbound SMS. |
| **Admin** | Lands on `/admin/containers`. Pool, drivers, locations, documents, and email-delivery test. No admin dashboard. |

Every movement write uses a client-generated event UUID, so a retry cannot double-post.

---

## Development

### Stats

| | |
| --- | --- |
| Nuxt / Vue | **4.5.2** / **3.5.41** |
| Node | **22** (`node:22-alpine` build, `node:22-bookworm-slim` run) |
| Postgres | **14+** via `DATABASE_URL` (no PostGIS) |
| Pages / API routes / components | 39 / 86 / 41 |
| Vitest | 46 files, 395 cases (`npm run test`) |
| Drizzle migrations | 17 (`drizzle/`) |

Other pins from `package.json`: Drizzle ORM **0.45.2**, `pg` **8.23.0**, Zod **4.4.3**, `nuxt-auth-utils` **0.5.30**, Tailwind **4.3.3**, Leaflet, Konva, Playwright.

### Run locally

Node.js 22+ and PostgreSQL 14+. The app does not start Postgres.

```bash
cp .env.example .env
# Set NUXT_SESSION_PASSWORD (32+ chars) and DATABASE_URL.
# SMTP can stay empty here — the verification link prints to the console.

npm install --legacy-peer-deps --no-audit --no-fund
npm run db:migrate
npm run db:seed
npm run dev                 # http://localhost:3000
```

`--legacy-peer-deps` is required (npm 10 / Nuxt 4.5 peer tree).

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@sensible.test` | `Password123!` |
| Driver | `driver@sensible.test` | `Password123!` |

Signup invite code is `NUXT_COMPANY_INVITE_CODE` (seed default **`SENSIBLE`**). Seed is idempotent. Not for production.

```bash
npm run lint          # ESLint
npm run test          # Vitest
npm run build         # → .output/
npm run db:generate | db:migrate | db:push | db:studio | db:seed
```

### Layout

```
app/pages/          Driver + admin screens
server/api/         HTTP
server/services/    Pool, events, placements, OCR, mail, ShipCSX, SMS
server/database/    Drizzle schema + seed
shared/utils/       ISO 6346, domain, wizard steps
drizzle/            SQL migrations
docker/             Entrypoint + migrator
```

**Containers** tab is the location list (`/containers` → `/locations/:id`). A box is `/containers/:id`.

### Environment

Required in production: `NUXT_APP_URL`, `NUXT_SESSION_PASSWORD`, `NUXT_COMPANY_INVITE_CODE`, `DATABASE_URL`, `NUXT_SMTP_HOST` (plus port / user / password). Full list: `.env.example`.

`openssl rand -base64 32` for the session secret. Unprefixed `SMTP_*` still works.

Signup needs a confirmed email. Empty SMTP in production refuses signup; in development it logs the link. Test mail from **Admin → Settings → Email delivery**. First boot creates the company from env — no seed required in production.

Optional: `NUXT_PUBLIC_APP_NAME`, `NUXT_COMPANY_NAME`, `NUXT_DATABASE_SSL`, `PORT` (`3847` in Docker), `NUXT_S3_*` (SeaweedFS, not Amazon), `NUXT_SHIPCSX_DEFAULT_TERMINAL` / `NUXT_SHIPCSX_POLL`, `NUXT_PUBLIC_MAP_TILES_URL` / `GEOCODER_URL`.

**More → system code** unlocks API connections (Quo SMS) and a demo data reset. ShipCSX is not on that screen — use Check CSX on a container. Production images install Chromium after the Nitro build; locally `npx playwright install chromium` if lookups fail.

Maps default to OpenStreetMap / Esri. Set `NUXT_PUBLIC_MAP_TILES_URL` for your own tiles.

### Deploy (Dokploy)

1. Create Postgres outside Compose. Copy `DATABASE_URL`.
2. Compose app from this repo (`app` + `seaweedfs`). It does not start a database.
3. Paste env. Minimum: session password, database, public URL, invite code, SMTP.
4. Domain → `app`, container port **3847**. Do not publish host 3000 or SeaweedFS.
5. Deploy. Entrypoint migrates, then Nitro. Health: `/api/health` (database must be up).
6. Confirm mail. Seed only on a demo box.

OCR models and Chromium are in the Debian runner. `SKIP_MIGRATIONS=true` only if you migrate elsewhere.

### Not wired yet

- SeaweedFS is in Compose; the S3 client in `server/services/storage.ts` still returns `501`.
- Offline Dexie outbox is not built. APIs are already idempotent. The Synced pill is a placeholder.
