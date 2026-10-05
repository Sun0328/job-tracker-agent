import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * The layers, bottom to top, and what each may import. A violation is a lint
 * error, so the structure in docs/ARCHITECTURE.md is enforced rather than hoped for.
 *
 *   domain      nothing else in src
 *   infra       domain
 *   data        domain, infra
 *   agent       domain, infra, data
 *   services    domain, infra, data, agent
 *   server      domain, services
 *   components  domain, components         (client code: no server modules)
 *   app         domain, data, services, server, components
 *   cli         domain, infra, data, agent, services
 *   scripts/    anything but app, components, server
 */
const layer = (target, allowed) => ({
  target: "./src/" + target,
  from: "./src",
  except: allowed.map((name) => "./" + name),
  message: target + " may only import from " + allowed.join(", ") + " (see docs/ARCHITECTURE.md)",
});

const zones = [
  layer("domain", ["domain"]),
  layer("infra", ["infra", "domain"]),
  layer("data", ["data", "domain", "infra"]),
  layer("agent", ["agent", "domain", "infra", "data"]),
  layer("services", ["services", "domain", "infra", "data", "agent"]),
  layer("server", ["server", "domain", "services"]),
  layer("components", ["components", "domain"]),
  layer("app", ["app", "domain", "data", "services", "server", "components"]),
  layer("cli", ["cli", "domain", "infra", "data", "agent", "services"]),
  {
    target: "./scripts",
    from: ["./src/app", "./src/components", "./src/server"],
    message: "scripts are CLI entry points: use src/cli and src/services, not the web layers",
  },
];

const eslintConfig = [
  {
    ignores: [
      ".next/**", ".next-e2e/**", "next-env.d.ts", "archive/**", "data/demo/**", "data/e2e/**", ".open-next/**", ".wrangler/**",
      "coverage/**", "playwright-report/**", "test-results/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    rules: {
      "import/no-restricted-paths": ["error", { basePath: __dirname, zones }],
    },
  },
];

export default eslintConfig;
