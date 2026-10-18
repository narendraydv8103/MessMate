# MessMate - Technical Implementation Plan (Zero-Budget Edition)

MessMate is a zero-budget, mobile-first Progressive Web Application (PWA) tailored for 4 roommates sharing meals at a mess. It coordinates daily meal attendance decisions and ensures the mess owner (Aunty) is reliably informed when the group will not eat at the mess.

---

## 1. System Architecture & Zero-Budget Workflow

### 1.1 Zero-Budget Architecture Overview

```
+---------------------------------------------------------------------------------------+
|                                    4 Roommates                                        |
|                          Mobile-First PWA (Next.js App Router)                        |
|                                                                                       |
|   - Log in via Roommate Selection + Group Passcode (or ?invite= link)                 |
|   - Authenticated via secure, signed, httpOnly session cookie                         |
|   - Submit ONE shared group decision before deadline (latest wins, transactional)     |
+---------------------------------------------------------------------------------------+
        |                                       ^                             ^
        | 1. Submit Group Decision              | Push Reminders              | Push Escalations
        v    ("JAAYENGE" / "NAHI_JAAYENGE")     | & Urgents (Web Push)        | (Every 10 min)
+---------------------------------------------------------------------------------------+
|                             Next.js App Router Backend                                |
|                                                                                       |
|  All endpoints require authenticated session:                                         |
|  /api/status   /api/decisions   /api/aunty/informed   /api/settings   /api/auth/*     |
|                                                                                       |
|  PostgreSQL Database (Supabase Free Tier via `pg` Connection Pool):                   |
|  - groups (Aunty's phone, group passcode, settings)                                  |
|  - members (4 roommates pre-seeded)                                                  |
|  - decisions (Append-only log with BIGSERIAL seq & UNIQUE idempotency_key)            |
|  - call_jobs (UNIQUE constraint on group + meal_date + meal_period)                   |
|  - reminder_log (Claim-first atomic dispatches)                                       |
|  - push_subscriptions (VAPID endpoints)                                              |
+---------------------------------------------------------------------------------------+
        ^
        | 2. Every Minute Secure Tick (Authorization: Bearer <CRON_SECRET>)
+-------------------------+
|   External Cron Worker  | (cron-job.org - Free Tier)
+-------------------------+
        |
        v
+---------------------------------------------------------------------------------------+
|  /api/cron/tick Engine (Injectable Clock, Asia/Kolkata Timezone via Luxon)            |
|                                                                                       |
|  A. Daily Reminder Phase (8:00 PM Mon-Sat / 12:30 PM Sun):                           |
|     - Atomically claim reminder via INSERT ... ON CONFLICT DO NOTHING RETURNING id    |
|     - Send Web Push to all roommates: "Mess reminder! Aaj khana hai kya?"            |
|                                                                                       |
|  B. Deadline Reached (9:30 PM Mon-Sat / 2:00 PM Sun):                                 |
|     - If latest decision is "JAAYENGE": Cancel pending job; meal closed.              |
|     - If "NAHI_JAAYENGE" or "NO_DECISION":                                            |
|       * Transition call_jobs to status `ACTION_REQUIRED`.                             |
|       * Trigger ManualNotifyProvider: dispatch urgent Web Push to all 4 members.      |
|                                                                                       |
|  C. Escalation Loop (while status == 'ACTION_REQUIRED'):                              |
|     - Re-send urgent push every 10 min (up to 3 times) until a roommate informs.       |
|     - Never auto-mark informed!                                                       |
+---------------------------------------------------------------------------------------+
        |
        v Status: ACTION_REQUIRED
+---------------------------------------------------------------------------------------+
|                               Roommate Urgent Action UI                               |
|                                                                                       |
|  Pulsing Alert: "AUNTY KO INFORM KARO!"                                               |
|  [ Call Aunty ] -> Native tel:+91XXXXXXXXXX link                                      |
|  [ WhatsApp Aunty ] -> wa.me link prefilled with exact Hindi message:                 |
|    "Namaste aunty, aaj hum chaaron mess mein khana khane nahi aayenge.                |
|     Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad."                 |
|                                                                                       |
|  [ Maine Aunty ko inform kar diya ] button -> POST /api/aunty/informed                |
|    - Records informed_by and informed_at                                              |
|    - Transitions status to `AUNTY_INFORMED` and halts escalations                      |
+---------------------------------------------------------------------------------------+
```

---

## 2. Business Rules & State Transitions

### 2.1 Schedule (IST - Asia/Kolkata)

| Day | Meal Period | Reminder Time | Deadline & Action Time |
| :--- | :--- | :--- | :--- |
| **Monday – Saturday** | Dinner | **8:00 PM IST** | **9:30 PM IST** |
| **Sunday** | Lunch | **12:30 PM IST** | **2:00 PM IST** |

### 2.2 Decision Rules & States

1. **One Shared Group Decision**:
   - Any of the 4 roommates can submit or change the group's decision at any point before the deadline.
   - There are no individual 4-way votes to tally; it is a single shared status.
   - Latest valid submission before the deadline wins.
2. **On Submitting `NAHI_JAAYENGE`**:
   - Stored in the append-only `decisions` log.
   - Transactionally upserts `call_jobs` with status `PENDING` and `scheduled_for = deadline`.
   - **Zero immediate notification or call is sent** — no action occurs until the deadline actually arrives.
3. **On Submitting `JAAYENGE`**:
   - Stored in the append-only `decisions` log.
   - Transactionally sets any existing `call_jobs` row to `CANCELLED`.
4. **Deadline Trigger (`tick` after deadline time)**:
   - Evaluates the latest decision from `decisions` using `ORDER BY seq DESC LIMIT 1`.
   - **If `JAAYENGE`**: Meal period is marked complete. No notification is sent to Aunty.
   - **If `NAHI_JAAYENGE` OR `NO_DECISION`**:
     - Status becomes `ACTION_REQUIRED`.
     - `action_required_at` is set to `NOW()`.
     - Dispatches initial urgent Web Push to all 4 members: *"Mess Alert: Aunty ko turant inform karo! Tap to open WhatsApp or Call."*
5. **Urgent Escalation Loop (Every 10 Minutes, Max 3 Times)**:
   - At `deadline + 10 min`: If still `ACTION_REQUIRED`, send 2nd urgent push.
   - At `deadline + 20 min`: If still `ACTION_REQUIRED`, send 3rd urgent push.
   - At `deadline + 30 min`: If still `ACTION_REQUIRED`, final urgent push alert.
   - Escalations cease as soon as any roommate marks `AUNTY_INFORMED`.
6. **Informing Aunty**:
   - Roommate clicks **Call Aunty** (`tel:<AUNTY_PHONE>`) or **WhatsApp Aunty** (`wa.me/<AUNTY_PHONE>?text=...`).
   - Prefilled WhatsApp Hindi text:
     > *"Namaste aunty, aaj hum chaaron mess mein khana khane nahi aayenge. Kripya hamare group ke liye aaj khana mat banaiyega. Dhanyavaad."*
   - Roommate taps **"Maine Aunty ko inform kar diya"**.
   - Frontend calls `POST /api/aunty/informed`.
   - Backend transitions status to `AUNTY_INFORMED`, records `informed_by_member_id`, `informed_by_name`, and `informed_at = NOW()`.
   - **Never auto-mark informed**.

---

## 3. Authentication & Security Architecture

### 3.1 Group Passcode & Roommate Identity
- **No Insecure Client Selectors**: The main dashboard does not let unauthenticated users select a roommate name.
- **Login Flow (`/login`)**:
  - The login form presents:
    1. Roommate selection (from the 4 pre-seeded members: e.g. Roommate 1, Roommate 2, Roommate 3, Roommate 4).
    2. Group Passcode input (or automatically populated via invite link: `https://messmate.app/login?invite=<PASSCODE>`).
  - Submits to `POST /api/auth/login`.
- **Login Rate Limiting**:
  - Tracked in-memory or in database: maximum 5 failed attempts per 15 minutes per IP address.
  - Returns `429 Too Many Requests` on exceeding threshold.
- **Session Cookie**:
  - Upon successful validation, issues a signed, tamper-proof cookie (e.g. `messmate_session`) with options:
    `httpOnly: true`, `secure: process.env.NODE_ENV === 'production'`, `sameSite: 'lax'`, `maxAge: 60 * 60 * 24 * 30` (30 days).
  - Session payload: `{ memberId: string, memberName: string, groupId: string, issuedAt: number }`.

### 3.2 Endpoint Protection Matrix
- **ALL application endpoints require an active, valid session cookie**:
  - `GET /api/status` -> `401 Unauthorized` if unauthenticated.
  - `POST /api/decisions` -> `401 Unauthorized` if unauthenticated.
  - `GET /api/decisions/history` -> `401 Unauthorized` if unauthenticated.
  - `POST /api/aunty/informed` -> `401 Unauthorized` if unauthenticated.
  - `GET /api/settings` and `PATCH /api/settings` -> `401 Unauthorized` if unauthenticated.
  - `POST /api/push/subscribe` -> `401 Unauthorized` if unauthenticated.
- **Cron Tick Authorization (`/api/cron/tick`)**:
  - Exempt from cookie auth.
  - Protected via `Authorization: Bearer <CRON_SECRET>`.
  - Secret verification **MUST** use constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks:
    ```ts
    function verifyCronSecret(providedHeader: string | null, expectedSecret: string): boolean {
      if (!providedHeader || !providedHeader.startsWith('Bearer ')) return false;
      const token = providedHeader.slice(7);
      const tokenBuf = Buffer.from(token);
      const secretBuf = Buffer.from(expectedSecret);
      if (tokenBuf.length !== secretBuf.length) return false;
      return crypto.timingSafeEqual(tokenBuf, secretBuf);
    }
    ```

---

## 4. Race Conditions, Transactions & Idempotency

### 4.1 Decision Submit Transaction Flow
To eliminate race conditions between multiple roommates or concurrent clicks:
1. `POST /api/decisions` begins a database transaction: `BEGIN;`.
2. **Server-Side IST Time Source**:
   - Compute current time in `Asia/Kolkata` using Luxon: `DateTime.now().setZone('Asia/Kolkata')`.
   - Never trust client-provided dates or times.
3. **Strict Deadline Enforcement**:
   - Compare server IST time against today's meal deadline (Mon–Sat 9:30 PM, Sun 2:00 PM).
   - If `current_time >= deadline`:
     - Rollback transaction `ROLLBACK;`.
     - Return HTTP `422 Unprocessable Entity`: `{ error: "Deadline has passed for this meal period. Status can no longer be updated." }`.
4. **Idempotency Key Verification**:
   - Client generates a UUID `idempotency_key` per form submit.
   - If a row with this `idempotency_key` already exists, return the existing recorded decision without re-inserting.
5. **Append-Only Decision Log**:
   - Insert new row into `decisions` table with `seq BIGSERIAL`, `idempotency_key`, `decision`, `submitted_by_member_id`, and `meal_date`.
6. **Row Locking on `call_jobs`**:
   - Execute:
     ```sql
     SELECT * FROM call_jobs 
     WHERE group_id = $1 AND meal_date = $2 AND meal_period = $3 
     FOR UPDATE;
     ```
   - If decision is `NAHI_JAAYENGE`:
     - Upsert `call_jobs` with `status = 'PENDING'`, `scheduled_for = deadline`.
     - Zero immediate notification is sent.
   - If decision is `JAAYENGE`:
     - Update `call_jobs` setting `status = 'CANCELLED'`.
7. `COMMIT;` transaction.

### 4.2 Scheduler Tick Locking & Claim-First Reminders
1. **Advisory Lock**:
   - The cron tick executes: `SELECT pg_try_advisory_xact_lock(hashtext('messmate_cron_tick'));`.
   - If lock is not acquired, another tick is running; immediately exit with `{ status: "locked", skipped: true }`.
2. **Daily Reminder Claim-First Pattern**:
   - Reminders must be sent once daily during the reminder window (8:00 PM Mon-Sat / 12:30 PM Sun), regardless of whether a decision has already been entered.
   - Atomically claim the reminder before sending:
     ```sql
     INSERT INTO reminder_log (group_id, meal_date, meal_period, reminder_type, sent_at)
     VALUES ($1, $2, $3, 'DAILY_REMINDER', NOW())
     ON CONFLICT (group_id, meal_date, meal_period, reminder_type) DO NOTHING
     RETURNING id;
     ```
   - Only if a row is returned (`result.rows.length > 0`) does the server dispatch the Web Push notifications!
3. **Fast Tick Execution**:
   - Ticks only process jobs whose `scheduled_for <= now()`.
   - Total tick duration is kept under 500ms.

---

## 5. Database Schema & PostgreSQL Specifications

The database driver **MUST be `pg` (`Pool`)** connecting to Supabase via its session/transaction connection pooler (port 5432 / 6543) so that `BEGIN ... COMMIT`, `FOR UPDATE`, and `pg_try_advisory_xact_lock` execute predictably over true stateful connection sessions.

```sql
-- Enable pgcrypto for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Groups Table (Aunty's phone stored here as the single source of truth)
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    aunty_phone VARCHAR(20) NOT NULL,                -- Source of truth in DB
    passcode_hash VARCHAR(255) NOT NULL,             -- Hashed group passcode
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    settings JSONB NOT NULL DEFAULT '{"notifications_enabled": true, "urgent_escalation_interval_min": 10}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Roommates / Members Table (Pre-seeded with 4 roommates)
CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    avatar_color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
    notification_preferences JSONB NOT NULL DEFAULT '{"push_enabled": true, "reminders": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Append-Only Decisions Log
-- Uses BIGSERIAL seq for reliable ordering and UNIQUE idempotency_key
CREATE TABLE decisions (
    seq BIGSERIAL PRIMARY KEY,                       -- Monotonically increasing sequence for ordering
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,     -- Prevents duplicate submissions
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,                         -- YYYY-MM-DD in Asia/Kolkata
    meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('JAAYENGE', 'NAHI_JAAYENGE')),
    submitted_by_member_id UUID NOT NULL REFERENCES members(id),
    submitted_by_name VARCHAR(100) NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for instant retrieval of the latest decision
CREATE INDEX idx_decisions_latest 
ON decisions(group_id, meal_date, meal_period, seq DESC);

-- 4. Call / Action Jobs Table
-- Enforces strictly at most ONE job row per group per meal date per period
CREATE TABLE call_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,
    meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'CANCELLED', 'ACTION_REQUIRED', 'AUNTY_INFORMED', 'NOT_CONFIGURED')),
    scheduled_for TIMESTAMPTZ NOT NULL,
    action_required_at TIMESTAMPTZ NULL,
    informed_by_member_id UUID NULL REFERENCES members(id),
    informed_by_name VARCHAR(100) NULL,
    informed_at TIMESTAMPTZ NULL,
    escalation_count INT NOT NULL DEFAULT 0,
    last_escalation_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_group_meal UNIQUE (group_id, meal_date, meal_period)
);

-- 5. Reminder Log Table
-- Atomic deduplication of reminders and escalations
CREATE TABLE reminder_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,
    meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
    reminder_type VARCHAR(50) NOT NULL 
        CHECK (reminder_type IN ('DAILY_REMINDER', 'URGENT_ESCALATION_1', 'URGENT_ESCALATION_2', 'URGENT_ESCALATION_3')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_reminder_claim UNIQUE (group_id, meal_date, meal_period, reminder_type)
);

-- 6. Push Subscriptions Table
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Provider Abstraction & Notification Dispatcher

### 6.1 CallProvider Extensible Interface
Even though budget is zero today, we retain the extensible provider contract so automated voice calling can be plugged in seamlessly in the future without altering core business logic:

```ts
// src/lib/telephony/types.ts
export interface CallProvider {
  readonly name: string;
  isConfigured(): boolean;
  executeDeadlineAction(context: DeadlineActionContext): Promise<DeadlineActionResult>;
}

export interface DeadlineActionContext {
  groupId: string;
  mealDate: string;
  mealPeriod: 'DINNER' | 'LUNCH';
  auntyPhone: string;
  reason: 'NAHI_JAAYENGE' | 'NO_DECISION';
  urgentMessage: string;
}

export interface DeadlineActionResult {
  status: 'ACTION_REQUIRED' | 'INITIATED' | 'NOT_CONFIGURED';
  details?: Record<string, unknown>;
  error?: string;
}
```

### 6.2 ManualNotifyProvider (Default Zero-Budget Provider)
- **`isConfigured()`**: Returns `true` if `AUNTY_PHONE` is present in DB.
- **`executeDeadlineAction(context)`**:
  - Does NOT dial a phone number.
  - Returns `{ status: 'ACTION_REQUIRED' }`.
  - Dispatches high-priority Web Push alerts to all roommates with payload:
    ```json
    {
      "title": "🚨 AUNTY KO INFORM KARO!",
      "body": "Aaj mess me koi nahi jaa raha. Kripya Aunty ko WhatsApp ya Call karke inform karein.",
      "url": "/",
      "tag": "messmate-urgent-action"
    }
    ```

---

## 7. Web Push Notification UX Rules

1. **NO Direct Decision Submission via Notification Actions**:
   - Push notifications will **NOT** include action buttons that silently record a decision in the background.
   - Tapping the notification opens the PWA directly to the confirmation dialog / decision toggle.
   - This prevents accidental submissions from accidental taps in notification centers.
2. **Standard VAPID Protocol**:
   - Subscriptions stored in `push_subscriptions`.
   - Dispatched server-side via `web-push`.

---

## 8. Complete API Routes Specification

| Route | Method | Auth | Function & Behavior |
| :--- | :--- | :--- | :--- |
| `/api/auth/login` | `POST` | Public (Rate-limited) | Validates roommate selection & group passcode. Sets signed `httpOnly` session cookie. |
| `/api/auth/logout` | `POST` | Authenticated | Clears session cookie. |
| `/api/auth/me` | `GET` | Authenticated | Returns current session's member and group info. |
| `/api/status` | `GET` | Authenticated | Returns active meal period, IST time, countdown to deadline, latest decision, call_job status (`ACTION_REQUIRED`, `AUNTY_INFORMED`, etc.), Aunty's phone, and formatted WhatsApp link. |
| `/api/decisions` | `POST` | Authenticated | Transactionally submits decision before deadline with server IST check, locks `call_jobs`, and updates status. |
| `/api/decisions/history` | `GET` | Authenticated | Returns append-only log of recent decisions for the group audit history. |
| `/api/aunty/informed` | `POST` | Authenticated | Called when a roommate taps "I informed Aunty". Updates `call_jobs` to `AUNTY_INFORMED`, records member ID, name, timestamp. |
| `/api/settings` | `GET` | Authenticated | Returns group settings (Aunty's phone, notification preferences). |
| `/api/settings` | `PATCH` | Authenticated | Updates Aunty's phone in DB or group preferences. |
| `/api/cron/tick` | `POST` | `Bearer CRON_SECRET` | 1-min scheduler tick. Checks reminders, evaluates deadlines, transitions to `ACTION_REQUIRED`, and handles 10-min push escalations. |
| `/api/push/subscribe` | `POST` | Authenticated | Saves/updates Web Push VAPID subscription for the current member. |
| `/api/push/test` | `POST` | Authenticated | Sends a test push notification to verify browser push capabilities. |

---

## 9. Frontend Screens & Mobile-First UX

The UI will be built with modern, sleek styling using Google Fonts (Outfit / Inter) and responsive cards:

1. **Login Screen (`/login`)**:
   - Roommate Selector: 4 distinct roommate profile pills.
   - Group Passcode Input (masked with show/hide toggle).
   - "Remember this device" option.
   - Clear rate-limit feedback if brute force is attempted.
2. **Main Dashboard (`/`)**:
   - Header with active roommate badge, link to `/roommates`, and link to `/settings`.
   - **Current Meal Card**:
     - Meal Title: "Today's Dinner" (Mon–Sat) / "Sunday Lunch" (Sun).
     - Live Countdown Timer to IST deadline.
   - **Big Decision Toggle**:
     - `JAAYENGE` (Green) / `NAHI JAAYENGE` (Amber/Rose).
     - Activity subtext: *"Decided by [Name] at 7:42 PM"*.
   - **Urgent Action Banner** (Active when `status === 'ACTION_REQUIRED'`):
     - High-visibility warning badge.
     - **[ Call Aunty ]**: Direct `tel:+91XXXXXXXXXX` action.
     - **[ WhatsApp Aunty ]**: Direct `wa.me` action prefilled with the exact Hindi message.
     - **[ Maine Aunty ko inform kar diya ]**: Button opening quick confirmation, setting status to `AUNTY_INFORMED`.
   - **Aunty Informed Banner** (Active when `status === 'AUNTY_INFORMED'`):
     - Success badge: *"Aunty was informed by [Name] at 9:34 PM"*.
3. **Roommates Screen (`/roommates`)**:
   - Lists the 4 roommates.
   - Indicates who is currently active on this device.
   - Shows push notification status for each member.
   - Logout button.
4. **Settings Screen (`/settings`)**:
   - **Aunty's Phone Number**: Editable field stored directly in Postgres.
   - **Group Passcode**: View / update passcode.
   - **Push Notifications**: Enable/Disable switch with **"Send Test Push"** button.
   - **Schedule Reference**: Explains Mon–Sat 8:00 PM/9:30 PM & Sun 12:30 PM/2:00 PM rules.
5. **History Screen (`/history`)**:
   - Reverse-chronological timeline of past meal decisions, who decided, and when Aunty was informed.

---

## 10. Scheduler Engine with Injectable Clock & Testing

### 10.1 Injectable Clock Architecture
```ts
// src/lib/scheduler/clock.ts
import { DateTime } from 'luxon';

export interface Clock {
  now(): DateTime;
}

export class SystemClock implements Clock {
  now(): DateTime {
    return DateTime.now().setZone('Asia/Kolkata');
  }
}

export class MockClock implements Clock {
  constructor(private currentTime: DateTime) {}

  now(): DateTime {
    return this.currentTime;
  }

  advance(duration: { minutes?: number; hours?: number; days?: number }): void {
    this.currentTime = this.currentTime.plus(duration);
  }

  setTime(time: DateTime): void {
    this.currentTime = time;
  }
}
```

### 10.2 Vitest Test Suite Specification

We will build comprehensive Vitest tests covering all critical edge cases:

1. **`src/__tests__/auth.test.ts`**:
   - Verify unauthenticated requests to `/api/status`, `/api/decisions`, `/api/settings` are rejected with HTTP 401.
   - Verify rate limiting triggers after 5 failed passcode attempts.
   - Verify cron tick rejects invalid secrets and accepts valid secrets using constant-time comparison.
2. **`src/__tests__/deadline-race.test.ts`**:
   - Uses `MockClock` set to 9:29:55 PM IST: verify decision submission succeeds.
   - Advances clock to 9:30:01 PM IST: verify decision submission fails with HTTP 422 ("Deadline passed").
3. **`src/__tests__/idempotency.test.ts`**:
   - Submits decision with `idempotency_key = "abc-123"`.
   - Submits identical payload with same `idempotency_key`: verify only 1 row exists in `decisions` table and return response matches.
4. **`src/__tests__/concurrent-ticks.test.ts`**:
   - Executes two concurrent tick operations using advisory locks; verifies only one worker processes the tick while the second cleanly skips.
5. **`src/__tests__/escalation.test.ts`**:
   - Advances clock to deadline (9:30 PM) with `NAHI_JAAYENGE`: verifies `call_jobs` transitions to `ACTION_REQUIRED` and initial urgent push is triggered.
   - Advances clock by +10 min: verifies `URGENT_ESCALATION_1` is logged and sent.
   - Advances clock by +20 min: verifies `URGENT_ESCALATION_2` is logged and sent.
   - Simulates roommate calling `/api/aunty/informed`: verifies status transitions to `AUNTY_INFORMED`.
   - Advances clock by +30 min: verifies NO further escalations are sent.

---

## 11. Free-Tier Cloud Limits Analysis & Recommendation

### 11.1 Neon vs. Supabase Free Tier Analysis

| Dimension | Neon Free Tier | Supabase Free Tier |
| :--- | :--- | :--- |
| **Compute Quota** | **100 compute hours / month** | **No compute-hour limit** (2 free projects) |
| **Per-Minute Ping Impact** | A 1-minute external cron ping generates 1,440 pings/day. Since Neon compute takes ~5 minutes of idle time to sleep, **compute never sleeps** (runs 24 hrs/day). 24 hrs × 30 days = **720 hours/month**. Neon free tier will be **exhausted in ~4.1 days**! | Supabase does not bill compute hours. Free projects are kept alive by traffic (they only pause after 7 days of complete inactivity, which our cron prevents). |
| **Connection Pooling** | Supports connection pooling, but compute still stays awake. | Built-in Supavisor pooler (`port 6543` / `port 5432`) handling serverless connections with transactions & session locking. |
| **Storage Quota** | 0.5 GB | 0.5 GB (more than enough for years of MessMate logs). |

### 11.2 Architectural Recommendation
> [!IMPORTANT]
> **Recommended Stack**: **Supabase Free Tier** + **Vercel Hobby** + **cron-job.org**
> - **Supabase**: Completely avoids the fatal Neon compute exhaustion under 1-minute cron pings, while supporting standard `pg` connection pooling for advisory locks.
> - **cron-job.org**: Free, highly reliable external cron service executing `POST https://<your-vercel-domain>/api/cron/tick` every minute.
> - **Vercel Hobby**: Fast Next.js hosting with serverless API routes.
> - **Web Push (VAPID)**: 100% free browser push notifications via Google FCM / Apple APNs gateways without third-party notification service fees.

---

## 12. External Accounts & Keys Checklist

| Item | Service | Role | Cost |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | **Supabase** | PostgreSQL Database with pooled connection string (`port 6543` / `port 5432` with `sslmode=require`). | **$0 (Free tier)** |
| `CRON_SECRET` | Self-Generated | 32+ character random secret (`openssl rand -hex 24`). Configured on cron-job.org. | **$0** |
| `SESSION_SECRET` | Self-Generated | 32+ character random secret for signing session cookies. | **$0** |
| `AUNTY_PHONE` | Mess Owner | Initial phone number for seed script (subsequently managed directly in DB settings). | **$0** |
| `GROUP_PASSCODE` | Seed Script | Passcode used by the 4 roommates to log in (e.g., `mess1234`). | **$0** |
| `VAPID_PUBLIC_KEY` | Web Push | Generated via `npx web-push generate-vapid-keys`. | **$0** |
| `VAPID_PRIVATE_KEY` | Web Push | Generated via `npx web-push generate-vapid-keys`. | **$0** |
| `VAPID_SUBJECT` | Web Push | Email address (e.g. `mailto:roommates@example.com`). | **$0** |
| `NEXT_PUBLIC_APP_URL` | Vercel | Production URL of the app. | **$0 (Hobby tier)** |
| **cron-job.org** | External Cron | Free account set to ping `/api/cron/tick` every 1 minute with `Authorization: Bearer <CRON_SECRET>`. | **$0** |
