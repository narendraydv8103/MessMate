-- Migration 006: Add last_test_push_at to members table for DB-backed rate limiting
ALTER TABLE members ADD COLUMN IF NOT EXISTS last_test_push_at TIMESTAMPTZ;
