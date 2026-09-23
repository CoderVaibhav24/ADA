/**
 * Generate `src/api/generated/ada-api.ts` from ada-api's OpenAPI document.
 *
 * The register's row, envelope and query types are NOT hand-written. FastAPI
 * already publishes the exact contract — `CaseRow`, `Page_CaseRow_`, and every
 * query parameter `CaseQuery` whitelists — and a hand-written interface beside
 * it is a second source of truth that drifts silently. A renamed field then
 * shows up as an empty column at runtime instead of a type error at build time.
 *
 * Usage:
 *   npm run api:types                       # reads $ADA_API_URL/api/openapi.json
 *   npm run api:types -- ../some/spec.json  # or a local spec file
 *
 * Note for whoever runs this next: the published spec is only as current as the
 * process serving it. The `ada-api` container image can predate a router that
 * exists in `services/api/app` — when that happens the generated file loses
 * types rather than gaining them, so check that `/api/icms/cases` is present in
 * the output before committing it. Generating from a spec file dumped out of
 * the source app is the reliable path in that situation.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../src/api/generated/ada-api.ts");

const base = process.env.ADA_API_URL ?? "http://127.0.0.1:8010";
const source = process.argv[2] ?? `${base}/api/openapi.json`;

mkdirSync(dirname(out), { recursive: true });

console.log(`openapi-typescript: ${source} -> ${out}`);
execFileSync(
  resolve(here, "../node_modules/.bin/openapi-typescript"),
  [source, "--output", out, "--alphabetize"],
  { stdio: "inherit" },
);
