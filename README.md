# MessMate 🍽️

MessMate is a zero-budget, mobile-first Progressive Web App (PWA) designed for 4 roommates sharing meal plans at a mess. It coordinates daily meal attendance decisions (Dinner & Lunch in `Asia/Kolkata` timezone), computes countdowns to deadlines, and alerts the mess owner (Aunty) via direct call/WhatsApp or automated Web Push when the group decides not to eat at the mess.

---

## Features

- **Mobile-First PWA**: Installable on Android & iOS (iOS 16.4+ via Add to Home Screen), offline awareness, responsive touch controls.
- **Decision Engine**: High-concurrency advisory-locked Postgres transactions ensuring deterministic last-write-wins decision state before meal deadlines.
- **Real Web Push (Free VAPID)**: Standardized Hinglish push notifications delivered directly to roommates' devices with automatic 404/410 dead subscription cleanup.
- **Manual Alerting Workflow**: If attendance is cancelled or undecided by deadline, transitions to `ACTION_REQUIRED`, offering pre-filled WhatsApp and direct phone dialers.
- **Cron Scheduler**: Endpoint hit every minute with timing-safe Bearer authentication, managing daily reminders, escalations, and 2-hour cutoffs.

---

## Environment Variables

Configure these variables in your deployment environment (e.g. Vercel, Railway, Supabase) or local `.env.local` file:

| Variable Name | Purpose / Scope | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (supports Supabase transaction pooler) | Yes |
| `SESSION_SECRET` | Secret used to sign httpOnly session cookies (min 32 characters) | Yes |
| `CRON_SECRET` | Secret protecting `/api/cron/tick` (min 32 characters) | Yes |
| `AUNTY_PHONE` | Initial phone number for Mess Owner Aunty (used during seed) | Yes (Seed) |
| `SEED_PASSCODE` | Shared group passcode for initial login (used during seed) | Yes (Seed) |
| `VAPID_PUBLIC_KEY` | VAPID public key for Web Push backend signing | Yes (Push) |
| `VAPID_PRIVATE_KEY` | VAPID private key for Web Push backend signing | Yes (Push) |
| `VAPID_SUBJECT` | Contact mailto: URI for VAPID push services (e.g. `mailto:admin@domain.com`) | Yes (Push) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | VAPID public key exposed to client browser to subscribe | Yes (Push) |
| `NEXT_PUBLIC_APP_URL` | Public application URL (e.g. `https://messmate.app`) | Optional |

> **Security Note:** Secrets must never be committed to git or exposed to the client.

---

## Setup & Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate VAPID Keys
To enable free Web Push notifications via standard VAPID:
```bash
npm run vapid:generate
```
This script generates a keypair and outputs the values to paste into your environment or `.env.local`.

### 3. Database Migrations & Seeding
Ensure `DATABASE_URL`, `AUNTY_PHONE`, and `SEED_PASSCODE` are set in your environment:
```bash
npm run seed
```
This will:
1. Sequentially apply all versioned SQL migrations in `src/lib/db/migrations/`.
2. Create the default group with the hashed passcode and Aunty's phone number.
3. Seed the 4 initial roommates (Aarav, Kabir, Rohan, Vivaan).

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Cron Scheduler Setup

Set up an external cron service (e.g. Cron-Job.org, GitHub Actions, or Vercel Cron) to trigger the tick endpoint every minute:

- **Method**: `POST`
- **URL**: `https://<YOUR_DEPLOYED_DOMAIN>/api/cron/tick`
- **Headers**:
  ```http
  Authorization: Bearer <YOUR_CRON_SECRET>
  ```

---

## Health Check Endpoint

For automated deployment verification and uptime monitoring:

- **Method**: `GET`
- **URL**: `/api/health`
- **Auth**: None
- **Response**: `200 OK`
  ```json
  { "ok": true }
  ```

---

## Testing & Quality Assurance

```bash
# Run linting
npm run lint

# Run all test suites
npx vitest run

# Run production build
npm run build
```
