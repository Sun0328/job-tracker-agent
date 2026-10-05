import { BASE_URL, LOCAL, type Health } from "./support";

/**
 * Runs once, before any test. The browser tests must never touch real data, so
 * this refuses to go on unless the target is the demo:
 *
 *   - any target must answer /api/demo with demo: true (writes are refused there);
 *   - a local target must use the local database and storage, and no model key;
 *   - a remote target must be the Worker on its D1 and R2 bindings;
 *   - with EXPECT_VERSION set, the target must be running that commit.
 */
export default async function globalSetup() {
  const get = async <T>(route: string): Promise<T> => {
    const response = await fetch(BASE_URL + route);
    if (!response.ok) throw new Error(BASE_URL + route + " answered " + response.status);
    return (await response.json()) as T;
  };

  const demo = await get<{ demo: boolean }>("/api/demo");
  if (!demo.demo) throw new Error(BASE_URL + " is not in demo mode. The browser tests only run against the demo.");

  const health = await get<Health>("/api/health");
  if (LOCAL) {
    if (health.driver !== "local" || health.files.driver !== "local") {
      throw new Error("The local server is on the " + health.driver + " database and " + health.files.driver + " storage. Start it with npm run e2e:serve.");
    }
    if (health.agent.mode !== "demo") throw new Error("The local server has a model key. The browser tests run the agent offline.");
  } else if (health.driver !== "d1-binding" || health.files.driver !== "r2-binding") {
    throw new Error(BASE_URL + " is not the demo Worker (driver " + health.driver + ", files " + health.files.driver + ").");
  }

  const expected = process.env.EXPECT_VERSION;
  if (expected && health.version !== expected) {
    throw new Error(BASE_URL + " runs " + (health.version ?? "an unversioned build") + ", expected " + expected + ".");
  }
}
