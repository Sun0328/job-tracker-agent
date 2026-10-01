import { flag, loadEnv } from "@/cli/args";
import { getDb, selectedDriver } from "@/infra/db";

/** Internal SQLite bookkeeping that must not be touched. */
const PROTECTED = /^(sqlite_|_cf_)/i;

async function main() {
  loadEnv();
  const db = await getDb();

  try {
    const tables = (await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ))
      .map((row) => String(row.name))
      .filter((name) => !PROTECTED.test(name));

    console.log("driver: " + selectedDriver() + " (" + db.driver + ")");
    if (!tables.length) {
      console.log("Nothing to drop.");
      return;
    }

    console.log("tables: " + tables.join(", "));

    if (!flag("yes")) {
      console.log("\nThis DROPS every table above, including any tracked applications.");
      console.log("Re-run with --yes to go ahead, then run db:migrate.");
      process.exitCode = 1;
      return;
    }

    for (const name of tables) {
      await db.run('DROP TABLE IF EXISTS "' + name + '"');
      console.log("  dropped " + name);
    }
    console.log("\nDropped " + tables.length + " table(s). Run db:migrate next.");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("db:reset failed: " + (error instanceof Error ? error.message : error));
  process.exitCode = 1;
});
