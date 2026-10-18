-- Migration 007: Add mess_name to groups table
ALTER TABLE groups ADD COLUMN IF NOT EXISTS mess_name VARCHAR(40) NOT NULL DEFAULT 'Mishra Tiffin Centre';
