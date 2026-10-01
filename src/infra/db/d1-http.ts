import { splitStatements, type Row, type SqlExecutor, type SqlValue } from "@/infra/db/executor";

const API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * D1 rejects a statement with more than 100 bound parameters
 * ("too many SQL variables"). Multi-row inserts have to be chunked to fit.
 */
export const D1_MAX_BOUND_PARAMS = 100;
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

interface D1StatementResult {
  results?: Row[];
  success?: boolean;
  meta?: { changes?: number; changed_db?: boolean; duration?: number; rows_read?: number; rows_written?: number };
}

interface D1Envelope {
  result?: D1StatementResult[];
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
}

export function readD1Config(): D1Config | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !databaseId || !apiToken) return null;
  return { accountId, databaseId, apiToken };
}

function requireConfig(): D1Config {
  const config = readD1Config();
  if (!config) {
    throw new Error(
      "D1 is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN, or run with JOB_DB=local.",
    );
  }
  return config;
}

async function request(config: D1Config, body: { sql: string; params?: SqlValue[] }): Promise<D1StatementResult[]> {
  const url = `${API_BASE}/accounts/${config.accountId}/d1/database/${config.databaseId}/query`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`D1 HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      continue;
    }

    const payload = (await response.json().catch(() => null)) as D1Envelope | null;
    if (!response.ok || !payload?.success) {
      const detail = payload?.errors?.map((item) => item.message).filter(Boolean).join("; ");
      throw new Error(`D1 query failed (${response.status}): ${detail || "unknown error"} — ${body.sql.slice(0, 160)}`);
    }
    return payload.result ?? [];
  }

  throw lastError ?? new Error("D1 request failed");
}

export function createD1HttpExecutor(): SqlExecutor {
  const config = requireConfig();

  return {
    driver: "d1-http",
    async all<T extends Row = Row>(sql: string, params: SqlValue[] = []) {
      const [statement] = await request(config, { sql, params });
      return (statement?.results ?? []) as T[];
    },
    async first<T extends Row = Row>(sql: string, params: SqlValue[] = []) {
      const [statement] = await request(config, { sql, params });
      return ((statement?.results ?? [])[0] ?? null) as T | null;
    },
    async run(sql: string, params: SqlValue[] = []) {
      const [statement] = await request(config, { sql, params });
      return { changes: statement?.meta?.changes ?? 0 };
    },
    async script(sql: string) {
      try {
        const statements = await request(config, { sql });
        return statements.map((statement) => statement.results ?? []);
      } catch (error) {
        // D1 normally answers a whole script in one request. If it refuses, fall
        // back to one request per statement so the real SQL error names itself.
        const parts = splitStatements(sql);
        if (parts.length < 2) throw error;
        const results: Row[][] = [];
        for (const part of parts) {
          const [statement] = await request(config, { sql: part });
          results.push(statement?.results ?? []);
        }
        return results;
      }
    },
    async close() {
      /* HTTP driver holds no handle */
    },
  };
}
