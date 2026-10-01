/**
 * One tiny SQL surface shared by both drivers so the same SQL runs against
 * Cloudflare D1 (production) and a local SQLite file (dev, tests, CLI).
 */
export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface SqlExecutor {
  readonly driver: "d1-http" | "local-sqlite";
  all<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T extends Row = Row>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Multiple statements, no parameters. Returns one result set per statement. */
  script(sql: string): Promise<Row[][]>;
  close(): Promise<void>;
}

/** Split a multi-statement script, ignoring semicolons inside strings and comments. */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    const next = script[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (!quote && char === "-" && next === "-") {
      lineComment = true;
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        if (next === quote) {
          // Escaped quote ('' or ""): consume both and stay inside the literal.
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
