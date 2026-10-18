-- ==============================================================================
-- Migration 004: Add MISSED status to call_jobs
-- ==============================================================================

ALTER TABLE call_jobs 
DROP CONSTRAINT IF EXISTS call_jobs_status_check;

ALTER TABLE call_jobs 
ADD CONSTRAINT call_jobs_status_check 
CHECK (status IN (
    'PENDING',
    'CANCELLED',
    'ACTION_REQUIRED',
    'AUNTY_INFORMED',
    'NOT_CONFIGURED',
    'MISSED'
));
