-- bError flags a run that needed attention: it failed outright, or a step inside
-- it failed (a validation that needed repair, a letter that came back two pages).
-- sStatus still says how the run ended; bError says whether anything went wrong.

ALTER TABLE AgentRun ADD COLUMN bError INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_run_error ON AgentRun (bError, dtDateTime);
