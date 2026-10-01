-- The status history table goes. Everything the dashboard needs now lives on Job:
--   sStatus         where it is now
--   sDeepestStatus  the furthest stage it ever reached (a rejection after a final
--                   interview still counts as a final)
--   dtApplied       when it was first sent
--   dtFirstResponse when someone first replied
-- These three are maintained on every status change, so a single UPDATE keeps the
-- funnel, the pipeline diagram and the response times correct.

ALTER TABLE Job ADD COLUMN sDeepestStatus TEXT NOT NULL DEFAULT 'Saved';
ALTER TABLE Job ADD COLUMN dtApplied TEXT;
ALTER TABLE Job ADD COLUMN dtFirstResponse TEXT;

-- Carry the existing history across before dropping it.
UPDATE Job SET sDeepestStatus = COALESCE((
  SELECT CASE MAX(CASE h.sStatus
      WHEN 'Applied' THEN 1
      WHEN 'HR screen' THEN 2
      WHEN 'Tech interview' THEN 3
      WHEN 'Behavior interview' THEN 4
      WHEN 'Final' THEN 5
      WHEN 'Offer' THEN 6
      ELSE 0 END)
    WHEN 6 THEN 'Offer'
    WHEN 5 THEN 'Final'
    WHEN 4 THEN 'Behavior interview'
    WHEN 3 THEN 'Tech interview'
    WHEN 2 THEN 'HR screen'
    WHEN 1 THEN 'Applied'
    ELSE 'Saved' END
  FROM JobStatusHistory h WHERE h.sJobUUID = Job.uuid
), 'Saved');

UPDATE Job SET dtApplied = (
  SELECT MIN(h.dtDateTime) FROM JobStatusHistory h
  WHERE h.sJobUUID = Job.uuid AND h.sStatus = 'Applied'
);

UPDATE Job SET dtFirstResponse = (
  SELECT MIN(h.dtDateTime) FROM JobStatusHistory h
  WHERE h.sJobUUID = Job.uuid
    AND h.sStatus IN ('HR screen', 'Tech interview', 'Behavior interview', 'Final', 'Offer')
);

DROP TABLE IF EXISTS JobStatusHistory;

CREATE INDEX IF NOT EXISTS idx_job_deepest ON Job (sDeepestStatus);
CREATE INDEX IF NOT EXISTS idx_job_applied ON Job (dtApplied);
