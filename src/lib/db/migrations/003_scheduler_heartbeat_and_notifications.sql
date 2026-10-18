-- ==============================================================================
-- Migration 003: Scheduler heartbeat table and notification tracking columns
-- ==============================================================================

-- 1. Scheduler Heartbeat Table
CREATE TABLE IF NOT EXISTS scheduler_heartbeat (
    id INT PRIMARY KEY DEFAULT 1,
    last_tick_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize default row if not exists
INSERT INTO scheduler_heartbeat (id, last_tick_at)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;

-- 2. Add send_status and error columns to reminder_log
ALTER TABLE reminder_log
ADD COLUMN IF NOT EXISTS send_status VARCHAR(30) NOT NULL DEFAULT 'NOT_CONFIGURED',
ADD COLUMN IF NOT EXISTS error TEXT NULL;

-- 3. Update reminder_log reminder_type check constraint to include URGENT_INITIAL
ALTER TABLE reminder_log 
DROP CONSTRAINT IF EXISTS reminder_log_reminder_type_check;

ALTER TABLE reminder_log 
ADD CONSTRAINT reminder_log_reminder_type_check 
CHECK (reminder_type IN (
    'DAILY_REMINDER',
    'URGENT_INITIAL',
    'URGENT_ESCALATION_1',
    'URGENT_ESCALATION_2',
    'URGENT_ESCALATION_3'
));
