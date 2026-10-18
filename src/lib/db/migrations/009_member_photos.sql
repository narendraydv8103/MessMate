-- ==============================================================================
-- Migration 009: Add Roommate Profile Photo Columns to Members
-- ==============================================================================

ALTER TABLE members
ADD COLUMN IF NOT EXISTS photo_data BYTEA NULL,
ADD COLUMN IF NOT EXISTS photo_mime VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS photo_updated_at TIMESTAMPTZ NULL;
