-- JobPilot schema (Cloudflare D1 / SQLite).
-- Naming: s = string, b = boolean (0/1), i = integer, dt = ISO 8601 datetime.

CREATE TABLE IF NOT EXISTS Job (
  uuid             TEXT PRIMARY KEY,
  sCompany         TEXT NOT NULL,
  bAgency          INTEGER NOT NULL DEFAULT 0,
  -- JSON {industry, business, website_url}. NULL when bAgency = 1.
  sCompanyMeta     TEXT,
  sJobTitle        TEXT NOT NULL,
  sJobRequirement  TEXT NOT NULL DEFAULT '',
  sContractType    TEXT,
  sLocation        TEXT,
  -- R2 object key of the generated cover letter PDF.
  sCoverLetterPath TEXT,
  sStatus          TEXT NOT NULL DEFAULT 'Saved',
  bDelete          INTEGER NOT NULL DEFAULT 0,
  dtDateTime       TEXT NOT NULL,
  dtUpdateDateTime TEXT NOT NULL,

  -- Extracted alongside the fields above; the dashboard reads these.
  sJobSummary      TEXT NOT NULL DEFAULT '',
  sSource          TEXT NOT NULL DEFAULT 'Other',
  sSourceUrl       TEXT,
  sTechStack       TEXT NOT NULL DEFAULT '[]',
  sNote            TEXT NOT NULL DEFAULT '',
  sRunID           TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_status  ON Job (sStatus);
CREATE INDEX IF NOT EXISTS idx_job_created ON Job (dtDateTime);
CREATE INDEX IF NOT EXISTS idx_job_company ON Job (sCompany);
CREATE INDEX IF NOT EXISTS idx_job_deleted ON Job (bDelete);

-- Every status change. The funnel is built from here, not from Job.sStatus, so a
-- rejection after a final interview still counts as having reached the final.
CREATE TABLE IF NOT EXISTS JobStatusHistory (
  iID        INTEGER PRIMARY KEY AUTOINCREMENT,
  sJobUUID   TEXT NOT NULL,
  sStatus    TEXT NOT NULL,
  dtDateTime TEXT NOT NULL,
  sNote      TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (sJobUUID) REFERENCES Job (uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_job  ON JobStatusHistory (sJobUUID, dtDateTime);
CREATE INDEX IF NOT EXISTS idx_history_when ON JobStatusHistory (dtDateTime);

-- One row per agent invocation: the "watch the response happen" record.
CREATE TABLE IF NOT EXISTS AgentRun (
  uuid              TEXT PRIMARY KEY,
  dtDateTime        TEXT NOT NULL,
  dtFinishDateTime  TEXT,
  sStatus           TEXT NOT NULL DEFAULT 'running',
  sMode             TEXT NOT NULL,
  sModel            TEXT,
  iInputChars       INTEGER NOT NULL DEFAULT 0,
  sInputHash        TEXT,
  sInputText        TEXT NOT NULL DEFAULT '',
  iDurationMs       INTEGER,
  iPromptTokens     INTEGER NOT NULL DEFAULT 0,
  iCompletionTokens INTEGER NOT NULL DEFAULT 0,
  iTotalTokens      INTEGER NOT NULL DEFAULT 0,
  iRepairCount      INTEGER NOT NULL DEFAULT 0,
  sError            TEXT,
  sResultJson       TEXT,
  sJobUUID          TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_created ON AgentRun (dtDateTime);
CREATE INDEX IF NOT EXISTS idx_run_status  ON AgentRun (sStatus);
CREATE INDEX IF NOT EXISTS idx_run_hash    ON AgentRun (sInputHash);

-- prepare / extract / validate / repair / cover-letter / persist
CREATE TABLE IF NOT EXISTS AgentRunStep (
  iID         INTEGER PRIMARY KEY AUTOINCREMENT,
  sRunUUID    TEXT NOT NULL,
  iSeq        INTEGER NOT NULL,
  sAgent      TEXT NOT NULL DEFAULT 'main',
  sName       TEXT NOT NULL,
  sLabel      TEXT NOT NULL DEFAULT '',
  sStatus     TEXT NOT NULL,
  dtDateTime  TEXT NOT NULL,
  iDurationMs INTEGER,
  iTokens     INTEGER NOT NULL DEFAULT 0,
  iAttempt    INTEGER NOT NULL DEFAULT 1,
  -- JSON array of tool calls made inside this step.
  sTools      TEXT NOT NULL DEFAULT '[]',
  sDetail     TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (sRunUUID) REFERENCES AgentRun (uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_step_run ON AgentRunStep (sRunUUID, iSeq);

-- Index of what is in R2: cover letter PDFs, your CV, advert snapshots.
CREATE TABLE IF NOT EXISTS JobFile (
  uuid         TEXT PRIMARY KEY,
  dtDateTime   TEXT NOT NULL,
  sJobUUID     TEXT,
  sKind        TEXT NOT NULL DEFAULT 'attachment',
  sStoragePath TEXT NOT NULL UNIQUE,
  sFileName    TEXT NOT NULL,
  sContentType TEXT NOT NULL DEFAULT 'application/octet-stream',
  iSizeBytes   INTEGER NOT NULL DEFAULT 0,
  sChecksum    TEXT,
  sNote        TEXT NOT NULL DEFAULT '',
  bDelete      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (sJobUUID) REFERENCES Job (uuid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_job  ON JobFile (sJobUUID, dtDateTime);
CREATE INDEX IF NOT EXISTS idx_file_kind ON JobFile (sKind, dtDateTime);
