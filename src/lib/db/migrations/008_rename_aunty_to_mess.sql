-- ==============================================================================
-- Migration 008: Rename aunty_phone to mess_phone and AUNTY_INFORMED to MESS_INFORMED
-- ==============================================================================

-- 1. Rename column aunty_phone to mess_phone if aunty_phone exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'groups' AND column_name = 'aunty_phone'
    ) THEN
        ALTER TABLE groups RENAME COLUMN aunty_phone TO mess_phone;
    END IF;
END $$;

-- 2. Drop existing CHECK constraint on call_jobs.status
ALTER TABLE call_jobs 
DROP CONSTRAINT IF EXISTS call_jobs_status_check;

-- 3. Update existing records with AUNTY_INFORMED to MESS_INFORMED
UPDATE call_jobs 
SET status = 'MESS_INFORMED' 
WHERE status = 'AUNTY_INFORMED';

-- 4. Recreate CHECK constraint with MESS_INFORMED
ALTER TABLE call_jobs 
ADD CONSTRAINT call_jobs_status_check 
CHECK (status IN (
    'PENDING',
    'CANCELLED',
    'ACTION_REQUIRED',
    'MESS_INFORMED',
    'NOT_CONFIGURED',
    'MISSED'
));
