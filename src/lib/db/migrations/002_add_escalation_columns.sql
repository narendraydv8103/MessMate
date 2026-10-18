-- ==============================================================================
-- Migration 002: Add escalation tracking columns to call_jobs
-- ==============================================================================

ALTER TABLE call_jobs 
ADD COLUMN IF NOT EXISTS escalation_count INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMPTZ NULL;
