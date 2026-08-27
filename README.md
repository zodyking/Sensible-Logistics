# Container Tracker

Mobile-first container custody tracking for drayage operations — pickups, drop-offs, yard
placement, and FMCSA 150 air-mile short-haul time records.

Phase 1 scaffold: working foundation, core driver and admin screens, full relational schema, and a
Dokploy-ready Docker stack. Heavier subsystems (OCR, self-hosted maps, the interactive yard editor,
the offline queue) sit behind clean service interfaces with `TODO(Phase 2)` markers.

---

## Stack and exact versions

Taken verbatim from `package.json`.

### Runtime dependencies

| Package | Version |
| --- | --- |
| `nuxt` | 4.5.2 |
| `vue` | 3.5.41 |
| `vue-router` | 4.6.3 |
| `drizzle-orm` | 0.45.2 |
| `nuxt-auth-utils` | 0.5.30 |
| `pg` | 8.23.0 |
| `zod` | 4.4.3 |

### Development dependencies

| Package | Version |
| --- | --- |
| `typescript` | 5.9.3 |
| `tailwindcss` | 4.3.3 |
| `@tailwindcss/vite` | 4.3.3 |
| `drizzle-kit` | 0.31.10 |
| `eslint` | 10.9.1 |
| `@nuxt/eslint` | 1.17.0 |
| `vitest` | 4.1.11 |
| `@vite-pwa/nuxt` | 1.1.1 |
| `@types/pg` | 8.23.1 |
| `tsx` | 4.23.12 |
| `@adonisjs/hash` | 9.1.1 |

### Infrastructure

| Component | Image / version |
| --- | --- |
| Node.js | 22 (`node:22-alpine`) |
| PostgreSQL | 14+ external (operator-provided), no extensions required. App reads `DATABASE_URL` |
| Object storage | `chrislusf/seaweedfs:latest` (S3-compatible mode) |

Install with the exact versions above:

```bash
npm install --legacy-peer-deps --no-audit --no-fund
```

`--legacy-peer-deps` works around an npm 10 arborist peer-resolution bug in Nuxt 4.5's optional
peer dependency tree. Without it, install fails with `Cannot read properties of null (reading
'edgesOut')`.

---

## Local development

Requires Node.js 22+ and an external PostgreSQL instance. The app does not start Postgres, and it
needs no database extensions.

```bash
# 1. Environment
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
# Set NUXT_SESSION_PASSWORD to 32+ characters and DATABASE_URL to your Postgres
# connection string. SMTP can stay empty in development — the verification link
# is printed to the console instead.

# 2. Database — provide your own Postgres and point DATABASE_URL at it, e.g.:
#   docker run -d --name ct-db -p 5432:5432 \
#     -e POSTGRES_USER=tracker -e POSTGRES_PASSWORD=tracker \
#     -e POSTGRES_DB=container_tracker postgres:17
# Then in .env:
#   DATABASE_URL=postgresql://tracker:tracker@localhost:5432/container_tracker

# 3. Schema and demo data
npm run db:migrate
npm run db:seed

# 4. Run
npm run dev                   # http://localhost:3000
```

### Seed credentials

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admin | `admin@sensible.test` | `Password123!` | `/admin/containers` |
| Driver | `driver@sensible.test` | `Password123!` | `/` |

Company invite code for driver self-registration at `/signup`: **`SENSIBLE`**

The seed is idempotent — re-running updates the demo company in place instead of duplicating it.

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Nuxt dev server |
| `npm run build` | Production build to `.output/` |
| `npm run preview` | Serve the production build |
| `npm run lint` / `lint:fix` | ESLint (`@nuxt/eslint`, stylistic rules on) |
| `npm run test` | Vitest unit tests |
| `npm run db:generate` | Generate a SQL migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push the schema directly (dev only) |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Load demo data |

---

## Environment variables

Every service is self-hosted. The app makes no outbound calls to any third-party API, and there
are no metered or paid dependencies anywhere in the stack — see [Self-hosting](#self-hosting).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `production` | Node environment |
| `PORT` | no | `3847` | Port the Nitro server binds in Docker/production. Not 3000 (Dokploy panel) |
| `HOST` | no | `0.0.0.0` | Bind address |
| `NUXT_PUBLIC_APP_NAME` | no | `Sensible Logistics Solutions LLC` | Site name — brand bar, page titles, email |
| `NUXT_PUBLIC_PWA_SHORT_NAME` | no | `Driver Portal` | Installed home-screen label. Build-time only |
| `NUXT_PUBLIC_PWA_DESCRIPTION` | no | `Driver Portal` | PWA install-prompt description. Build-time only |
| `NUXT_APP_URL` | **yes** | — | Public origin, no trailing slash. Builds email verification links |
| `NUXT_SMTP_HOST` | **yes** | — | SMTP server for verification email — see [Email](#email) |
| `NUXT_SMTP_PORT` | no | `587` | `587` for STARTTLS, `465` for implicit TLS. The port decides encryption |
| `NUXT_SMTP_USER` | no | — | SMTP login. Also the default From address |
| `NUXT_SMTP_PASSWORD` | no | — | SMTP password. An app password where the provider requires one |
| `NUXT_SMTP_FROM_EMAIL` | no | `NUXT_SMTP_USER` | From address. Only set it when the provider allows sending as another mailbox |
| `NUXT_SMTP_FROM_NAME` | no | — | Optional display name in front of the From address |
| `NUXT_SESSION_PASSWORD` | **yes** | — | Seals the session cookie. Minimum 32 characters |
| `NUXT_COMPANY_INVITE_CODE` | **yes** | — | Shared code drivers type at `/signup` — see [Company identity](#company-identity) |
| `NUXT_COMPANY_NAME` | no | `Container Tracker` | Company name shown in the UI |
| `NUXT_COMPANY_LEGAL_NAME` | no | — | Carrier legal name on the DOT time record |
| `NUXT_COMPANY_USDOT_NUMBER` | no | — | USDOT number on the DOT time record |
| `NUXT_COMPANY_TIMEZONE` | no | `America/New_York` | IANA zone for timecard days and the roadside PDF |
| `NUXT_COMPANY_CYCLE_TYPE` | no | `SEVENTY_EIGHT` | `SEVENTY_EIGHT` (70h/8d) or `SIXTY_SEVEN` (60h/7d) |
| `DATABASE_URL` | **yes** | — | External Postgres connection string. The app does not create Postgres |
| `NUXT_DATABASE_SSL` | no | `false` | `true` for managed Postgres requiring TLS |
| `NUXT_S3_ENDPOINT` | no | `http://seaweedfs:8333` | Your SeaweedFS container. Not Amazon — see below |
| `NUXT_S3_REGION` | no | `us-east-1` | Protocol formality SeaweedFS ignores |
| `NUXT_S3_BUCKET` | no | `container-tracker` | Private bucket for documents and photos |
| `NUXT_S3_ACCESS_KEY_ID` | no | — | Key you invent for your SeaweedFS container (Phase 2) |
| `NUXT_S3_SECRET_ACCESS_KEY` | no | — | Secret you invent for your SeaweedFS container (Phase 2) |
| `NUXT_OCR_SERVICE_URL` | no | — | Unused. Container/chassis OCR runs SAFEContain (Tesseract + trained tessdata) inside the app image |
| `NUXT_OCR_TESSDATA_DIR` | no | `.data/safecontain/tessdata` | Directory containing SAFEContain `eng.traineddata`. Downloaded on first scan if missing |
| `NUXT_PUBLIC_MAP_TILES_URL` | no | — | Self-hosted tile server (Phase 2) |
| `NUXT_PUBLIC_GEOCODER_URL` | no | — | Self-hosted Nominatim (Phase 2) |
| `SKIP_MIGRATIONS` | no | `false` | `true` boots the container without migrating |

Generate a session secret:

```bash
openssl rand -base64 32
```

---

## Email

Driver signup requires email confirmation (spec 4). SMTP is configured entirely through
environment variables — credentials are never stored in the database or editable in the app.

### The flow

1. A driver submits `/signup` with the company invite code. The account is created but **no
   session is issued**, and `users.email_verified_at` stays null.
2. A single-use link is emailed to them, valid for 24 hours.
3. Opening the link confirms the address and signs them in, landing them on the driver home.
4. Until then, `/api/auth/login` rejects them with `403` and the sign-in screen offers to resend.

Only the SHA-256 digest of each token is stored, so a database leak cannot be replayed to take
over an unverified account. Requesting a new link invalidates any outstanding one, and resends are
throttled to one per minute. The resend endpoint always reports success so it cannot be used to
discover which addresses are registered.

### Choosing an SMTP host

Point `NUXT_SMTP_HOST` at a mailbox that already has working SPF, DKIM, and DMARC — a business
mailbox, your host's relay, or an internal mail server. This is plain SMTP, not a metered API, so
it satisfies the self-hosting rule in spec 29.

Sending directly from the application server is the common failure mode: a fresh VPS IP has no
sending reputation, many providers block outbound port 25, and verification mail that lands in
spam means drivers cannot finish signup.

### Settings that decide whether mail arrives

| Setting | What to use |
| --- | --- |
| Port | `587` (STARTTLS) or `465` (implicit TLS). Encryption follows the port, so there is nothing else to switch |
| From address | Leave `NUXT_SMTP_FROM_EMAIL` unset unless the provider lets you send as a different mailbox. Gmail, Outlook and most relays reject a From they do not own, and the default is `NUXT_SMTP_USER` |
| Password | Where the provider offers app passwords (Gmail, Outlook, Fastmail), use one. An account password with 2FA enabled is refused with `535` |
| Display name | `NUXT_SMTP_FROM_NAME` is quoted for you, so commas and periods in a company name are safe |

Unprefixed `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are read as aliases
when the `NUXT_`-prefixed variable is absent, so an existing env set works unchanged. `SMTP_FROM`
takes a complete header: `"Sensible Logistics" <no-reply@example.com>`.

Credentials are only ever sent over an encrypted connection: if the relay does not offer STARTTLS,
the send fails instead of falling back to plaintext.

### Testing delivery

**Admin → Settings → Email delivery** shows whether SMTP is configured and sends a test message. It
reports the mail server's own answer — `535 Invalid login`, a refused connection, an expired
certificate — so a broken variable is named rather than guessed. The same check is available as
`POST /api/admin/smtp-test` with an optional `{"to": "someone@example.com"}` body.

Signup itself stays vague on purpose: an anonymous visitor is told only that the confirmation email
could not be sent. The full SMTP reply goes to the server log, prefixed `[mail]`.

### Without SMTP

If `NUXT_SMTP_HOST` is empty, behaviour differs by environment on purpose:

- **Development** logs the verification link to the console and surfaces it on screen, so signup
  can be exercised without credentials.
- **Production** refuses signup with a clear error instead of creating accounts that can never be
  confirmed.

### Not implemented

Phone verification. The spec asks for it, but SMS requires a metered third party such as Twilio,
which conflicts with the zero-paid-service rule in spec 29. The mobile number is collected as a
contact field and `users.phone_verified_at` is reserved for it.

---

## Company identity

This deployment serves one trucking company, configured entirely through environment variables.
On first boot the app creates the company row from them, so a fresh production database is usable
without running the demo seed.

### The invite code

`NUXT_COMPANY_INVITE_CODE` is the shared secret a driver types at `/signup` to join. It is
operator-owned rather than editable in the app, because it grants access to company data —
rotating it should be a deliberate deploy action, not a button an admin can click by accident.

- **To rotate it** (after a driver leaves, say): change the value and redeploy. Existing accounts
  are unaffected; only new signups use the code.
- Matching ignores case, spaces, and dashes, so `sens-ible` and `SENSIBLE` both work.
- Comparison is timing-safe, and a wrong code returns `403` without revealing whether a company
  exists.
- If the variable is unset, signup returns `503` and explains the misconfiguration instead of
  silently accepting anything.

`/admin/settings` displays the current code read-only with a copy button, so an admin can share it
with new hires.

### Changing it later

Because the code lives in the environment, the deployed value and your `.env` never drift apart.
The database column still exists — the schema is multi-tenant by design (spec 17) — and the app
syncs the primary company row to the environment on every boot.

---

## Self-hosting

Nothing in this stack calls a third-party service, and nothing is metered. Every component runs
as a container you control.

### "S3" does not mean Amazon

The `NUXT_S3_*` variables configure **SeaweedFS**, the object-storage container defined in
`docker-compose.yml`. S3 is the wire protocol it speaks, which is the only reason the variables
carry that name — standard S3 clients work against your own server without a bespoke SDK.

- The endpoint is `http://seaweedfs:8333`, an internal Docker hostname with no route to the
  public internet.
- The access key and secret are values *you* invent for that container, not credentials issued
  by a cloud provider.
- Photos and documents are written to the `seaweed-data` volume on your host.

The spec (sections 10 and 29) chose SeaweedFS over storing binaries in Postgres because large
images bloat the database, slow backups, and make streaming downloads awkward. Postgres stays the
authoritative record; it holds all document *metadata* and every operational event, while the
files themselves live on the volume next to it.

If you ever want files inside Postgres anyway, `server/services/storage.ts` is a narrow interface
(`put` / `get` / `delete` / `signedUrl` / `healthCheck`), so a `PostgresLargeObjectStorage` class
could be dropped in without touching any calling code.

### Phase-2 services

Deliberately left unset rather than pointed at public endpoints. Spec 31.1/31.2 forbids the
community `tile.openstreetmap.org` and `nominatim.openstreetmap.org` servers in production: their
usage policies prohibit this traffic, and geocoding customer facility addresses through a public
API leaks your operational footprint. Run your own containers instead.

| Service | Self-hosted component |
| --- | --- |
| OCR | SAFEContain tessdata via Tesseract in the app image (container + chassis numbers) |
| Map tiles | PMTiles archive generated locally with Planetiler |
| Geocoding | Nominatim with only your operating region imported |
| Background jobs | pg-boss, backed by the same Postgres |
| Offline cache | Dexie.js over IndexedDB, in the browser |

---

## Dokploy deployment

1. **Create Postgres outside the app.** In Dokploy add a **Database** (Postgres) service, or use
   any existing PostgreSQL host. Copy its connection string. The stock Postgres template is fine —
   no extensions are required.
2. **Create the app.** Add a **Compose** application and point it at this repository. Dokploy
   builds `app` from the `Dockerfile` and starts `seaweedfs` alongside it. It does **not**
   start a database.
3. **Set environment variables.** Paste the keys from `.env.example` into the Dokploy environment
   UI. At minimum set `NUXT_SESSION_PASSWORD` (32+ characters), `DATABASE_URL` (the external
   connection string), `NUXT_APP_URL`, `NUXT_COMPANY_INVITE_CODE`, and the SMTP block —
   `NUXT_SMTP_HOST`, `NUXT_SMTP_PORT`, `NUXT_SMTP_USER`, `NUXT_SMTP_PASSWORD`. Mail is what
   finishes driver signup, so confirm it from **Admin → Settings → Email delivery** after the
   first deploy.
4. **Do not publish host ports.** Compose does not map 3000 (Dokploy's panel). Traffic
   comes through the reverse proxy.
5. **Attach a domain.** In Dokploy's **Domains** tab, map your hostname to the `app` service on
   container port `3847` and enable Let's Encrypt. Remove any leftover `APP_PORT=3000` from
   the Environment tab — it is unused.
6. **Deploy.** The entrypoint runs Drizzle migrations (with connection retry) against
   `DATABASE_URL` before the Nitro server starts, and refuses to start the server if they fail.
   The image's `HEALTHCHECK` polls `/api/health`, so Dokploy will not route traffic to an
   unhealthy container.
7. **Seed (optional).** For a demo environment, exec into the app container and run the seed
   against `DATABASE_URL`. Skip this for production.

`seaweedfs` stays on the internal `container-tracker` bridge network and publishes no ports.
Object-storage data lives in the `seaweed-data` named volume. Postgres data lives on the
external database, not in this compose file.

### Geospatial storage needs no extensions

Coordinates are plain `numeric` latitude/longitude columns, drawn boundaries are GeoJSON polygons in
`jsonb`, and proximity search uses the haversine formula in SQL. Nothing in the schema depends on
PostGIS, so the operator-supplied database can be any PostgreSQL 14+ server.

---

## What is functional vs stubbed

### Functional — wired to real API routes and the database

- **Auth**: session login, public driver signup with company invite code, logout. Roles are
  `DRIVER` and `ADMIN`; signup can only ever create a `DRIVER`. Every API route enforces role and
  tenant isolation server-side.
- **Driver Home**: duty status with a live ticking on-duty clock, Clock In/Out, active movement
  card with a contextual primary action, recent containers and locations.
- **New Pickup**: multi-step flow with real ISO 6346 check-digit validation (client and server),
  active-pool resolution (reuse active / reactivate historical / create new / conflict), a
  transactional claim protected by a partial unique index, chassis selection, loaded/empty and
  seal capture, and a confirm step that writes immutable events plus denormalised state in one
  transaction.
- **Active movement and drop-off**: destination selection, chassis retain/detach, final-release
  handling, complete.
- **Containers**: list with search and scope filter; detail with the full custody event timeline.
- **Timecard**: Clock In/Out punches, today's total, preceding 7-day on-duty total, rolling cycle
  progress, history, short-haul status banner, and a server-generated printable
  §395.1(e)(1) time record with record ID and integrity hash.
- **Locations**: list with occupancy, and a create form with duplicate detection across normalised
  address, name and geographic proximity.
- **Admin**: `/admin/containers` and `/admin/drivers` with working search and filters;
  `/admin/locations`, `/admin/documents` and `/admin/settings` as designed shells fed by real
  queries. There is deliberately **no** admin dashboard page — admins land on `/admin/containers`.
- **Health**: `/api/health` reports database, mail, OCR and storage status for the Docker
  healthcheck. Only the database can mark the container unhealthy; the rest report `degraded` so a
  missing optional service never stops traffic.
- **Idempotency**: every mutating operational endpoint takes a client-generated event UUID and
  enforces it, so an offline retry can never double-post a custody event.

### Stubbed behind service interfaces

| Subsystem | Interface | Behaviour today |
| --- | --- | --- |
| OCR | `server/services/ocr.ts` (`recognizeSceneText`, `recognizeDocument`, `healthCheck`, `engineVersion`) | SAFEContain trained tessdata via Tesseract. Pickup and `/scan` take a full-screen photo (or library image) |
| Object storage | `server/services/storage.ts` | `NotConfiguredStorageService`; upload validation and key generation are implemented |
| Geocoding | `server/services/geocoding.ts` | `NotConfiguredGeocoder`; address normalisation and duplicate detection are implemented |
| Yard editor | `app/components/YardMapPlaceholder.vue` | Schematic placeholder. Drop-off stores a placeholder placement when yard positioning is selected |
| Offline queue | `app/utils/sync.ts` | Interface only. Dexie/IndexedDB outbox is Phase 2 |
| PDF rendering | `/timecard/[date]/record` | Print-optimised HTML. Playwright PDF generation is Phase 2 |
| Pending-sync indicator | top bar pill | Static until the outbox exists |

---

## Quality gate results

```
npm run test    →  2 test files, 48 tests passed  (ISO 6346 + domain vocabulary)
npm run lint    →  0 errors, 0 warnings
npm run build   →  Build complete. Total size 4.39 MB (1.11 MB gzip)
```

---

## Project structure

```
.
├── app/                        # Nuxt 4 app directory
│   ├── assets/css/main.css     # Design tokens + component classes (Tailwind v4 @theme)
│   ├── components/             # StatusChip, PageHeader, EmptyState, EventTimeline, YardMapPlaceholder
│   ├── layouts/                # default (driver + bottom tabs), admin (left nav), auth
│   ├── middleware/             # auth.global.ts — role routing and route guards
│   ├── pages/
│   │   ├── index.vue           # Driver Home
│   │   ├── login.vue signup.vue scan.vue more.vue
│   │   ├── admin/              # containers, drivers, locations, documents, settings
│   │   ├── containers/         # list + [id] detail
│   │   ├── locations/          # list + new
│   │   ├── pickups/            # list + new (multi-step)
│   │   ├── timecard/           # index + [date]/record (printable)
│   │   └── trips/[id].vue      # Active movement + drop-off
│   └── utils/                  # format.ts, sync.ts (offline queue interface)
├── server/
│   ├── api/                    # auth, home, containers, pickups, trips, locations, chassis,
│   │                           # timecard, scan, admin, health
│   ├── database/               # schema.ts (25 tables), seed.ts
│   ├── services/               # activePool, events, movements, timecards, ocr, storage, geocoding
│   └── utils/                  # db, session, validate
├── shared/utils/               # iso6346.ts, domain.ts  (imported by both app and server)
├── test/                       # iso6346.spec.ts, domain.spec.ts, phone.spec.ts
├── drizzle/                    # Generated SQL migrations
├── docker/                     # entrypoint.sh, migrate.mjs
├── public/                     # PWA icons, favicon
├── Dockerfile  docker-compose.yml  .dockerignore  .env.example
├── nuxt.config.ts  drizzle.config.ts  eslint.config.mjs  vitest.config.ts
└── Agent-Files/                # Internal reference material — git-ignored, not published
```

---

## Design

**Direction** — Industrial operations console: dark navy chrome, amber as the single action colour,
paper-grey work surfaces, and dense monospace equipment numbers, tuned for gloved hands and direct
sunlight.

### Tokens

Extracted from the approved design template into Tailwind v4 `@theme` and CSS custom properties in
`app/assets/css/main.css`.

- **Palette** — Navy `#081624` / `#0C1E30` / `#13293F` / `#1D3A57` / `#2C5075` (chrome, headers,
  timeline rail); Amber `#F0A422` with `#D98E0B` hover (the only primary-action colour);
  Paper `#EDF0F2` / `#F7F9FA` and lines `#CBD4DA` / `#E0E6EA` (surfaces); Ink `#141F29` →
  `#8A959D` (four text weights); status `ok #1D7A4C`, `warn #AE5808`, `err #B23A30`,
  `info/transit #2F6FA7`, each paired with a 100-level tint for chip backgrounds.
- **Type** — Space Grotesk for display and numerics, Inter for UI text, JetBrains Mono for
  container, chassis and seal numbers. Scale: `0.72 / 0.84 / 0.95 / 1.08 / 1.3 / 1.6 / 2 rem`,
  with uppercase `0.12–0.16em` tracking on eyebrows and section labels.
- **Spacing** — 4 px base step (`--s1`…`--s8`: 4 / 8 / 12 / 16 / 20 / 24 / 32). Cards use 16 px
  padding; the top bar is 56 px and the bottom tab bar 64 px plus safe-area inset.
- **Radius** — 8 px (chips, inputs), 12 px (cards, rows), 16 px (duty card, sheets), full (pills).
- **Elevation** — Two shadows only: `--shadow-1` at rest on cards, `--shadow-2` raised for the
  duty card and sticky bars.

### Responsive behaviour

Mobile-first throughout. The driver shell is a fixed 56 px top bar plus a six-item bottom tab bar
(Home, Pickups, Scan, Containers, Timecard, More) with a raised Scan action and a safe-area inset
for notched devices; the content column caps at 520 px and centres on larger screens so everything
stays thumb-reachable. Admin uses a single-column stack with a drawer nav on small screens,
switching to a sticky left nav and denser tables on desktop. Multi-step flows keep one decision per
screen with the primary action at the bottom. No horizontal overflow from 320 px upward.

### Accessibility

- Every status is a chip carrying a **glyph plus a text label**, never colour alone.
- Interactive targets are at least 44 px tall; primary actions are 52 px.
- Body text meets WCAG AA against paper surfaces; the navy chrome and amber actions exceed AA for
  outdoor legibility.
- Semantic HTML throughout — `<dl>` for record fields, `<table>` with `<caption>` and scoped
  headers for the DOT record, `<nav>` with `aria-current` on tabs.
- Live regions: `role="status"` on loading and validation feedback, `role="alert"` on errors,
  `role="timer"` on the elapsed on-duty clock, `role="progressbar"` with full ARIA values on
  cycle and occupancy bars.
- Visible focus rings are preserved everywhere; the printable time record includes a `sr-only`
  table caption and drops non-print chrome.

---

## Notes on the spec

The product specification and the approved design template live in `Agent-Files/`, which is
git-ignored and kept out of this repository. Both are reference material and are left untouched.
The Driver Home replicates the template's dashboard visual language closely; other screens were
elevated to production quality within the same design system.
