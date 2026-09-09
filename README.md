<div align="center">
  <img src="public/icons/icon-192.svg" width="88" height="88" alt="Yard Manager" />

  <h1>Yard Manager</h1>

  <p>
    <strong>Container operations for Sensible Logistics</strong><br />
    Drivers run the yard from a phone. Dispatchers run the company from a desk.
  </p>

  <p>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
    <img alt="Nuxt" src="https://img.shields.io/badge/Nuxt-4-00DC82?style=flat-square&logo=nuxt&logoColor=white" />
    <img alt="Vue.js" src="https://img.shields.io/badge/Vue-3-42B883?style=flat-square&logo=vuedotjs&logoColor=white" />
    <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" />
    <img alt="PWA" src="https://img.shields.io/badge/PWA-ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white" />
  </p>
</div>

<br />

## Features

Installable PWA with a four-tab driver bar: **Dashboard**, **Tasks**, **Locations**, **Me**. Sign-in is email plus a six-digit code. Session cookies last **30 days**.

### Driver

| | |
| :--- | :--- |
| **Dashboard** | Assigned work, pickup list, in-progress trips, and SMS to a trip contact. |
| **Tasks** | Open jobs, trip history, and equipment search. |
| **Arrive** | Confirm arrival, drop, hook, and swap. Destination, chassis, and load/empty are collected in the flow. |
| **Locations** | Yards, terminals, customers, and chassis pools. Add equipment, inspect, and run OCR from the camera. |
| **Trips** | Timeline, documents, contacts, and SMS. |
| **Equipment** | Container detail, chassis, and per-diem. |

### Admin

| | |
| :--- | :--- |
| **Overview** | Company snapshot and operational counts. |
| **Drivers** | Invite by email. Drivers finish setup with a verification code. |
| **Inventory** | Containers and chassis across locations. |
| **Locations** | Directory, contacts, and notes. |
| **Billing** | Per-diem rates, billing parties, and invoices. |
| **Account** | Company profile. |

---

## Development

| | |
| ---: | :--- |
| **App** | Nuxt **4.5.2** · Vue **3.5.41** · Pinia · Tailwind CSS v4 · Vite PWA |
| **API** | Nitro · Zod **4.4.3** · `h3-session` |
| **Data** | Drizzle ORM **0.45.2** · `pg` **8.23.0** · PostgreSQL **16** |
| **Auth** | Session cookie · email verification codes (Resend in production) |
| **Pages** | **39** |
| **API routes** | **82** |
| **Components** | **40** |
| **Tests** | **46** Vitest files · **394** cases |
| **Migrations** | **18** |

### Prerequisites

- Node.js **22+**
- PostgreSQL **16** (`createdb sensible_logistics`)

### Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

App: [http://localhost:3000](http://localhost:3000)

| | |
| :--- | :--- |
| **Driver** | `driver@sensible.test` / `Password123!` |
| **Admin** | `admin@sensible.test` / `Password123!` |

```bash
npm run lint          # ESLint
npm run typecheck     # vue-tsc
npm test              # Vitest
npm run build         # Production bundle
```

### Environment

Copy `.env.example`. Required for a full local run:

| Variable | Purpose |
| :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string |
| `NUXT_SESSION_PASSWORD` | Session signing secret (**≥32 characters**) |
| `APP_BASE_URL` | Public origin (seeded users and links) |
| `RESEND_API_KEY` | Transactional email |
| `RESEND_FROM` | From address |
| `TWILIO_ACCOUNT_SID` | SMS |
| `TWILIO_AUTH_TOKEN` | SMS |
| `TWILIO_FROM_NUMBER` | SMS |
| `GOOGLE_PLACES_API_KEY` | Address autocomplete |
| `GOOGLE_TIMEZONE_API_KEY` | Timezone lookup |
| `OCR_SERVICE_URL` | Document OCR endpoint |

Unset Twilio, Resend, Google, or OCR variables disable those integrations. Seeded logins still work.

### Production

Dokploy on a **Debian** runner: Node 22, PostgreSQL 16, Nginx. Build with `npm ci && npm run build`. Start with `node .output/server/index.mjs`. Run `npm run db:migrate` against the production database before first traffic.

Set `APP_BASE_URL` to the public HTTPS origin. Use a session password of at least 32 characters.
