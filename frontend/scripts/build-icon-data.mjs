/**
 * Builds the OFFLINE icon bundle for the ICMS portal.
 *
 * Why this exists: @iconify/react will happily fetch an unknown icon from
 * api.iconify.design at render time. This is a government deployment that may
 * run air-gapped, so no icon may depend on the network. This script resolves
 * every semantic key in src/lib/icons/icon-map.ts, across every bundled set,
 * into fully-resolved icon DATA and writes it to a generated module. At runtime
 * <Icon icon={dataObject} /> is handed an object, never a string, so there is
 * no code path that can reach the network.
 *
 * It is also the gap report: any key whose name does not exist in a non-default
 * set is listed, and falls back to the default set for that key.
 *
 *   node --experimental-strip-types scripts/build-icon-data.mjs
 *   npm run icons:build
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getIconData } from "@iconify/utils";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const { ICON_MAP, ICON_SETS, DEFAULT_ICON_SET } = await import(
  resolve(root, "src/lib/icons/icon-map.ts")
);

const setIds = Object.keys(ICON_SETS);
const collections = Object.fromEntries(
  setIds.map((id) => [id, require(`@iconify-json/${id}/icons.json`)]),
);

const out = {};

const gaps = [];

for (const [key, entry] of Object.entries(ICON_MAP)) {
  for (const setId of setIds) {
    const wanted =
      setId === DEFAULT_ICON_SET ? entry.name : (entry.per?.[setId] ?? entry.name);
    const data = getIconData(collections[setId], wanted);
    if (data) {
      delete data.hidden;
      out[`${setId}:${wanted}`] = data;
    } else {
      gaps.push({ key, setId, wanted });
    }
  }
}

const fatal = gaps.filter((g) => g.setId === DEFAULT_ICON_SET);
if (fatal.length) {
  console.error(
    `\nFATAL: ${fatal.length} key(s) do not exist in the default set "${DEFAULT_ICON_SET}":`,
  );
  for (const g of fatal) console.error(`  ${g.key} -> ${g.setId}:${g.wanted}`);
  process.exit(1);
}

const fallbacks = {};
for (const g of gaps) {
  (fallbacks[g.setId] ??= {})[g.key] = true;
}

const banner = `// GENERATED FILE — DO NOT EDIT. Run \`npm run icons:build\`.
//
// Source of truth: src/lib/icons/icon-map.ts
// Bundled sets: ${setIds.join(", ")}
// Icons bundled: ${Object.keys(out).length} (subset — only what the map names)
//
// Icons are stored as resolved IconifyIcon data, not as "set:name" strings, so
// <Icon icon={data} /> never has a reason to call the Iconify HTTP API. The
// portal renders identically with no network.
`;

const body = `${banner}
import type { IconifyIcon } from "@iconify/react";

export const ICON_DATA: Record<string, IconifyIcon> = ${JSON.stringify(out, null, 0)};

/** Semantic keys with no equivalent in a given set; they render the default set instead. */
export const ICON_FALLBACKS: Record<string, Record<string, true>> = ${JSON.stringify(fallbacks, null, 0)};
`;

const target = resolve(root, "src/lib/icons/icon-data.generated.ts");
writeFileSync(target, body);

const bytes = readFileSync(target).length;
console.log(`wrote ${target}`);
console.log(
  `  ${Object.keys(ICON_MAP).length} keys x ${setIds.length} sets -> ${Object.keys(out).length} unique icons, ${(bytes / 1024).toFixed(1)} kB`,
);
if (gaps.length) {
  console.log(`  ${gaps.length} gap(s), each falling back to "${DEFAULT_ICON_SET}":`);
  for (const g of gaps) console.log(`    ${g.setId.padEnd(18)} ${g.key} -> ${g.wanted}`);
} else {
  console.log("  no gaps: every key resolves in every bundled set");
}
