-- ==============================================================================
-- MessMate Database Schema (Zero-Budget PostgreSQL)
-- Compatible with PostgreSQL 14+, Neon, and Supabase (Transaction Pooler)
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Groups Table
-- Stores mess configuration, hashed passcode, and Aunty's phone as source of truth.
CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    aunty_phone VARCHAR(20) NOT NULL,
    passcode_hash VARCHAR(255) NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Kolkata',
    settings JSONB NOT NULL DEFAULT '{"notifications_enabled": true, "urgent_escalation_interval_min": 10}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Roommates / Members Table
-- Pre-seeded with 4 roommates belonging to the group.
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    avatar_color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
    notification_preferences JSONB NOT NULL DEFAULT '{"push_enabled": true, "reminders": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Append-Only Decisions Log
-- Every submission is a new immutable row. Uses BIGSERIAL for monotonic ordering.
CREATE TABLE IF NOT EXISTS decisions (
    seq BIGSERIAL PRIMARY KEY,
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(100) NOT NULL UNIQUE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    meal_date DATE NOT NULL,
    meal_period VARCHAR(20) NOT NULL CHECK (meal_period IN ('DINNER', 'LUNCH')),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('JAAYENGE', 'NAHI_JAAYENGE')),
    submitted_by_member_id UUID NOT NULL REFERENCES members(id),
    submitted_by_name VARCHAR(100) NOT NULL,
    notes TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decisions_latest 
ON decisions(group_id, meal_date, meal_period, seq DESC);

-- 4. Call / Action Jobs Table
-- Strictly at most ONE job row per group per meal date per meal period.
CREATE TABLE IF NOT EXISTS call_jobs (
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
-- Atomic deduplication of reminders and urgent escalations.
CREATE TABLE IF NOT EXISTS reminder_log (
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
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Login Rate Limits Table (Optional DB fallback for distributed rate limiting)
CREATE TABLE IF NOT EXISTS login_rate_limits (
    ip_address VARCHAR(50) PRIMARY KEY,
    failed_attempts INT NOT NULL DEFAULT 1,
    first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_until TIMESTAMPTZ NULL
);
