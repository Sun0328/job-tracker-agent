-- How well the CV fits each advert, rated by Jev against a four-level rubric.
--   sMatch       Weak match | Fair match | Good match | Strong match. NULL = not rated yet.
--   iMatchScore  0-100, the probability-weighted position on the rubric, so two
--                "Good match" rows can still be told apart.
--   sMatchMeta   JSON: the per-dimension scores, probabilities and confidence, which
--                resume was rated, the model version and when. This is the debug trail.

ALTER TABLE Job ADD COLUMN sMatch TEXT;
ALTER TABLE Job ADD COLUMN iMatchScore INTEGER;
ALTER TABLE Job ADD COLUMN sMatchMeta TEXT;

CREATE INDEX IF NOT EXISTS idx_job_match ON Job (sMatch);
