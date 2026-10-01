import { D1_MAX_BOUND_PARAMS, getDb } from "@/infra/db";
import type { Row, SqlValue } from "@/infra/db";
import type { AgentRun, AgentRunSummary, RunStep, ToolCall } from "@/domain";

const RUN_COLUMNS = [
  "uuid", "dtDateTime", "dtFinishDateTime", "sStatus", "sMode", "sModel", "iInputChars", "sInputHash",
  "sInputText", "iDurationMs", "iPromptTokens", "iCompletionTokens", "iTotalTokens", "iRepairCount",
  "bError", "sError", "sResultJson", "sJobUUID",
];
const SELECT_RUN = RUN_COLUMNS.join(", ");

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result === "" ? null : result;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRunBase(row: Row) {
  return {
    uuid: text(row.uuid),
    dtDateTime: text(row.dtDateTime),
    dtFinishDateTime: nullableText(row.dtFinishDateTime),
    sStatus: text(row.sStatus) as AgentRun["sStatus"],
    sMode: text(row.sMode) as AgentRun["sMode"],
    sModel: nullableText(row.sModel),
    iInputChars: Number(row.iInputChars ?? 0),
    sInputHash: nullableText(row.sInputHash),
    iDurationMs: row.iDurationMs == null ? null : Number(row.iDurationMs),
    oUsage: {
      promptTokens: Number(row.iPromptTokens ?? 0),
      completionTokens: Number(row.iCompletionTokens ?? 0),
      totalTokens: Number(row.iTotalTokens ?? 0),
    },
    iRepairCount: Number(row.iRepairCount ?? 0),
    bError: row.bError === 1 || row.bError === true,
    sError: nullableText(row.sError),
    sJobUUID: nullableText(row.sJobUUID),
  };
}

function rowToStep(row: Row): RunStep {
  return {
    iSeq: Number(row.iSeq ?? 0),
    sAgent: text(row.sAgent) as RunStep["sAgent"],
    sName: text(row.sName),
    sLabel: text(row.sLabel),
    sStatus: text(row.sStatus) as RunStep["sStatus"],
    dtDateTime: text(row.dtDateTime),
    iDurationMs: row.iDurationMs == null ? null : Number(row.iDurationMs),
    iTokens: Number(row.iTokens ?? 0),
    iAttempt: Number(row.iAttempt ?? 1),
    aTools: parseJson<ToolCall[]>(row.sTools, []),
    oDetail: parseJson<Record<string, unknown>>(row.sDetail, {}),
  };
}

/**
 * A finished run is archived in two round trips: the run row, then every step in
 * one multi-row INSERT. D1 over HTTP charges a request per statement, so this
 * keeps the cost flat no matter how many steps a run took.
 */
export async function saveRun(run: AgentRun): Promise<void> {
  const db = await getDb();

  await db.run(
    "INSERT OR REPLACE INTO AgentRun (" + SELECT_RUN + ") VALUES (" + RUN_COLUMNS.map(() => "?").join(", ") + ")",
    [
      run.uuid, run.dtDateTime, run.dtFinishDateTime, run.sStatus, run.sMode, run.sModel, run.iInputChars,
      run.sInputHash, run.sInputText, run.iDurationMs, run.oUsage.promptTokens, run.oUsage.completionTokens,
      run.oUsage.totalTokens, run.iRepairCount, run.bError ? 1 : 0, run.sError,
      run.oResult ? JSON.stringify(run.oResult) : null, run.sJobUUID,
    ],
  );

  if (!run.aSteps.length) return;
  await db.run("DELETE FROM AgentRunStep WHERE sRunUUID = ?", [run.uuid]);

  const STEP_COLUMNS = 12;
  // D1 allows 100 bound parameters per statement, so a long run goes in batches.
  const perStatement = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / STEP_COLUMNS));

  // The run row is already in; say so if only the steps fail, rather than
  // reporting the whole archive as lost.
  try {
    await insertSteps(db, run, perStatement);
  } catch (error) {
    throw new Error(
      "the run row was saved but its steps were not: " + (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function insertSteps(
  db: Awaited<ReturnType<typeof getDb>>,
  run: AgentRun,
  perStatement: number,
): Promise<void> {
  for (let offset = 0; offset < run.aSteps.length; offset += perStatement) {
    const batch = run.aSteps.slice(offset, offset + perStatement);
    const params: SqlValue[] = [];
    for (const step of batch) {
      params.push(
        run.uuid, step.iSeq, step.sAgent, step.sName, step.sLabel, step.sStatus, step.dtDateTime,
        step.iDurationMs, step.iTokens, step.iAttempt, JSON.stringify(step.aTools), JSON.stringify(step.oDetail),
      );
    }
    await db.run(
      "INSERT INTO AgentRunStep (sRunUUID, iSeq, sAgent, sName, sLabel, sStatus, dtDateTime, iDurationMs, iTokens, iAttempt, sTools, sDetail) VALUES "
        + batch.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", "),
      params,
    );
  }
}

export async function attachJobToRun(runUUID: string, jobUUID: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE AgentRun SET sJobUUID = ? WHERE uuid = ?", [jobUUID, runUUID]);
}

export async function getRun(uuid: string): Promise<AgentRun | null> {
  const db = await getDb();
  const row = await db.first("SELECT " + SELECT_RUN + " FROM AgentRun WHERE uuid = ?", [uuid]);
  if (!row) return null;

  const steps = await db.all(
    "SELECT iSeq, sAgent, sName, sLabel, sStatus, dtDateTime, iDurationMs, iTokens, iAttempt, sTools, sDetail"
      + " FROM AgentRunStep WHERE sRunUUID = ? ORDER BY iSeq ASC",
    [uuid],
  );

  return {
    ...rowToRunBase(row),
    sInputText: text(row.sInputText),
    oResult: parseJson<AgentRun["oResult"]>(row.sResultJson, null),
    aSteps: steps.map(rowToStep),
  };
}

export interface RunFilter {
  sStatus?: AgentRun["sStatus"];
  /** Only runs where something went wrong, or only clean ones. */
  bError?: boolean;
  sJobUUID?: string;
  limit?: number;
  offset?: number;
}

export async function listRuns(filter: RunFilter = {}): Promise<AgentRunSummary[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: SqlValue[] = [];

  if (filter.sStatus) {
    where.push("r.sStatus = ?");
    params.push(filter.sStatus);
  }
  if (filter.bError !== undefined) {
    where.push("r.bError = ?");
    params.push(filter.bError ? 1 : 0);
  }
  if (filter.sJobUUID) {
    where.push("r.sJobUUID = ?");
    params.push(filter.sJobUUID);
  }

  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const sql = [
    "SELECT " + RUN_COLUMNS.map((column) => "r." + column).join(", ") + ",",
    "  substr(r.sInputText, 1, 240) AS sInputPreview,",
    "  (SELECT COUNT(*) FROM AgentRunStep s WHERE s.sRunUUID = r.uuid) AS iStepCount",
    "FROM AgentRun r",
    where.length ? "WHERE " + where.join(" AND ") : "",
    "ORDER BY datetime(r.dtDateTime) DESC, r.uuid DESC",
    "LIMIT ? OFFSET ?",
  ].filter(Boolean).join("\n");

  const rows = await db.all(sql, [...params, limit, offset]);
  return rows.map((row) => ({
    ...rowToRunBase(row),
    iStepCount: Number(row.iStepCount ?? 0),
    sInputPreview: text(row.sInputPreview),
  }));
}

/** Re-analysing the same advert is usually a mistake; the hash makes it visible. */
export async function findRunByInputHash(sInputHash: string): Promise<AgentRunSummary | null> {
  const db = await getDb();
  const row = await db.first(
    "SELECT " + SELECT_RUN + ", substr(sInputText, 1, 240) AS sInputPreview, 0 AS iStepCount"
      + " FROM AgentRun WHERE sInputHash = ? AND sStatus = 'succeeded' ORDER BY datetime(dtDateTime) DESC LIMIT 1",
    [sInputHash],
  );
  if (!row) return null;
  return {
    ...rowToRunBase(row),
    iStepCount: Number(row.iStepCount ?? 0),
    sInputPreview: text(row.sInputPreview),
  };
}

export async function deleteRun(uuid: string): Promise<boolean> {
  const db = await getDb();
  await db.run("DELETE FROM AgentRunStep WHERE sRunUUID = ?", [uuid]);
  const result = await db.run("DELETE FROM AgentRun WHERE uuid = ?", [uuid]);
  return result.changes > 0;
}
