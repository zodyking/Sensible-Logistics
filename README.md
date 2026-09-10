<div align="center">

# Yard Manager

**Container operations for Sensible Logistics**

Drivers work trips from a phone. Dispatchers work the pool from a map.

<p>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="Nuxt" src="https://img.shields.io/badge/Nuxt-4-00DC82?style=flat-square&logo=nuxt&logoColor=white" />
  <img alt="Vue.js" src="https://img.shields.io/badge/Vue-3-42B883?style=flat-square&logo=vuedotjs&logoColor=white" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-14+-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white" />
</p>

</div>

<br />

## Features

Installable PWA. Sign-in is **email and password**. New accounts need the company invite code, then a confirmation **link** sent over SMTP.

### Driver

Five-tab bar: **Home**, **Trips**, **Tasks**, **Containers**, **More**.

| | |
| :--- | :--- |
| **Home** | Active trip, arrive / drop / hook / swap, documents, contacts, and SMS when Quo is configured. |
| **Trips** | Pickup history and calendar. |
| **Tasks** | Open work and SMS forwarding from the driver’s phone. |
| **Containers** | Yards, customers, marine terminals, and rail yards. Add equipment and read numbers from the camera. |
| **Equipment** | Container and chassis records. |
| **Account** | Profile, email, password, and phone under More → Settings. |

### Dispatcher

Signup as **Dispatcher** uses the same invite code. Dispatchers land on the map board, not the driver home.

| | |
| :--- | :--- |
| **Dispatch** | Map of locations, container pool, and assign pickup / delivery / hook tasks. |
| **Inventory** | Location directory. |
| **Drivers** | Roster. |
| **Documents** | Uploaded files. |
| **Settings** | Company identity, invite code, and SMTP delivery test. |

---

## Development

| | |
| ---: | :--- |
| **App** | Nuxt **4.5.2** · Vue **3.5.41** · Tailwind CSS **4.3.3** · Vite PWA · Leaflet |
| **API** | Nitro · Zod **4.4.3** · `nuxt-auth-utils` |
| **Data** | Drizzle ORM **0.45.2** · `pg` **8.23.0** · PostgreSQL **14+** |
| **Auth** | Session cookie · SMTP confirmation links (Nodemailer) |
| **SMS** | Quo, configured in-app under API connections |
| **OCR** | On-server OpenOCR (no remote OCR vendor) |
| **Pages** | **40** |
| **API routes** | **84** |
| **Components** | **41** |
| **Tests** | **47** Vitest files · **399** cases |
| **Migrations** | **18** |

### Prerequisites

- Node.js **22+**
- PostgreSQL **14+**

### Setup

```bash
npm install
cp .env.example .env
# Point DATABASE_URL at your database, then:
npm run db:migrate
npm run db:seed
npm run dev
```

`.env.example` sets `PORT=3847`. If that is unset, Nuxt listens on 3000.

| | |
| :--- | :--- |
| **Driver** | `driver@sensible.test` / `Password123!` |
| **Dispatcher** | `admin@sensible.test` / `Password123!` |

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### Environment

Copy `.env.example`. These are the variables the app actually reads:

| Variable | Purpose |
| :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string |
| `NUXT_SESSION_PASSWORD` | Session signing secret (**≥32 characters**) |
| `NUXT_APP_URL` | Public origin for email links |
| `NUXT_COMPANY_INVITE_CODE` | Shared signup code |
| `NUXT_COMPANY_NAME` | Company name |
| `NUXT_SMTP_HOST` | Outbound mail (required to verify accounts in production) |
| `NUXT_SMTP_PORT` | `587` (STARTTLS) or `465` (TLS) |
| `NUXT_SMTP_USER` | SMTP login |
| `NUXT_SMTP_PASSWORD` | SMTP password |
| `NUXT_S3_ENDPOINT` | Object storage (S3 API, typically SeaweedFS) |
| `NUXT_S3_BUCKET` | Bucket name |
| `NUXT_S3_ACCESS_KEY_ID` | Storage access key |
| `NUXT_S3_SECRET_ACCESS_KEY` | Storage secret |
| `NUXT_PUBLIC_MAP_TILES_URL` | Optional self-hosted map tiles |
| `NUXT_PUBLIC_GEOCODER_URL` | Optional self-hosted geocoder; otherwise Photon (OSM) |

Address search is OpenStreetMap, not Google Places. Mail is SMTP, not Resend. Trip SMS is Quo, not Twilio. There is no invoicing or billing module.

Without SMTP, local signup logs the confirmation link to the console. Seeded logins still work.

### Production

Dokploy with the repo compose file. The app listens on **3847**. Postgres is external (**14+**). Traefik should target that port. Set `NUXT_APP_URL`, `NUXT_SESSION_PASSWORD`, `NUXT_COMPANY_INVITE_CODE`, `DATABASE_URL`, and SMTP before serving traffic. The image runs migrations on boot unless `SKIP_MIGRATIONS=true`.
