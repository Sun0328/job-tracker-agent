-- The public demo lets each visitor run one live AI analysis. One row per run
-- that was allowed to start, so the limits are a COUNT away:
--   one run per visitor (random id in the visitor's cookie),
--   a few runs per IP per day (sIpHash: salted SHA-256, never the IP itself),
--   and a daily cap across everyone, which bounds the DeepSeek bill.
-- Unused outside demo mode. The nightly demo reset leaves this table alone, so
-- "one run per visitor" holds across resets.

CREATE TABLE IF NOT EXISTS DemoRun (
  iID        INTEGER PRIMARY KEY AUTOINCREMENT,
  sVisitor   TEXT NOT NULL,
  sIpHash    TEXT NOT NULL,
  dtDateTime TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_visitor ON DemoRun (sVisitor);
CREATE INDEX IF NOT EXISTS idx_demo_ip      ON DemoRun (sIpHash, dtDateTime);
CREATE INDEX IF NOT EXISTS idx_demo_when    ON DemoRun (dtDateTime);
