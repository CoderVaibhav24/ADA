/**
 * Generate `src/services/api/generated/ada-api.ts` from ada-api's OpenAPI document.
 *
 * The same generator, the same spec and the same command as the web portal
 * (`frontend/scripts/generate-api-types.mjs`). Two clients of one API must not
 * hand-write two ideas of what `CaseRow` contains; a renamed field has to be a
 * build error on both, not an empty field on one.
 *
 * `openapi-typescript` is not a dependency of this workspace: it peer-requires
 * TypeScript 5 and this repo is on 6. It is resolved from the monorepo root,
 * where the portal already installs it, so both clients generate with one version.
 *
 * Usage:
 *   npm run api:types                       # reads $ADA_API_URL/api/openapi.json
 *   npm run api:types -- ../some/spec.json  # or a local spec file
 *
 * The published spec is only as current as the process serving it: the running
 * container can predate a router that exists in `backend/api/app`. Check that the
 * endpoints you need are in the output before committing it. As of 2026-09-22 the
 * inspection endpoints (`/api/icms/cases/{case_ref}/rounds/...`) exist as Pydantic
 * schemas but have no router, so they are absent from the generated file.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hostSideApiUrl, resolveAdaConfig } from '../ada.config.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../src/services/api/generated/ada-api.ts');
const cli = resolve(here, '../../node_modules/.bin/openapi-typescript');

if (!existsSync(cli)) {
  console.error(
    'openapi-typescript is missing. Run `npm install` at the monorepo root — it is ' +
      'hoisted there rather than installed in app/.',
  );
  process.exit(1);
}

// Runs on the Mac, so the local preset's emulator alias is swapped for the loopback address.
const base = process.env.ADA_API_URL ?? hostSideApiUrl(resolveAdaConfig());
const source = process.argv[2] ?? `${base}/api/openapi.json`;

mkdirSync(dirname(out), { recursive: true });

console.log(`openapi-typescript: ${source} -> ${out}`);
execFileSync(cli, [source, '--output', out, '--alphabetize'], { stdio: 'inherit' });
