import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "@/cli/args";
import { getDb, selectedDriver, splitStatements } from "@/infra/db";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

/** Same bookkeeping table wrangler uses, so both tools stay in agreement. */
const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function main() {
  loadEnv();

  const db = await getDb();
  console.log("driver: " + selectedDriver() + " (" + db.driver + ")");

  await db.run(TRACKING_TABLE);
  const applied = new Set(
    (await db.all<{ name: string }>("SELECT name FROM d1_migrations")).map((row) => String(row.name)),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log("  skip   " + file);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitStatements(sql);
    for (const statement of statements) await db.run(statement);
    await db.run("INSERT INTO d1_migrations (name) VALUES (?)", [file]);
    console.log("  apply  " + file + " (" + statements.length + " statements)");
    ran += 1;
  }

  console.log(ran ? "\nApplied " + ran + " migration(s)." : "\nNothing to apply.");
  await db.close();
}

main().catch((error) => {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
