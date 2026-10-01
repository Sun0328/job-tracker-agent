-- Every agent run now leaves a Job row behind, successful or not. bError marks the
-- rows that came out of a run that went wrong, so the dashboard can exclude them
-- and you can still see what was attempted.

ALTER TABLE Job ADD COLUMN bError INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_job_error ON Job (bError, dtDateTime);
