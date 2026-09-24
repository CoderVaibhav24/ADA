// en/hi parity check for CI and `npm run test:i18n`: same keys, same {placeholders}. Exits 1 on any mismatch.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../src/services/i18n');
const cache = new Map();

// Loads a message module by transpiling it; only relative imports of other message files are followed.
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  cache.set(file, module.exports);
  const local = (spec) => (spec.startsWith('.') ? load(resolve(dirname(file), `${spec}.ts`)) : require(spec));
  new Function('exports', 'require', 'module', outputText)(module.exports, local, module);
  cache.set(file, module.exports);
  return module.exports;
}

const { en } = load(resolve(root, 'en.ts'));
const { hi } = load(resolve(root, 'hi.ts'));
const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

const problems = [];
for (const key of Object.keys(en)) {
  if (!(key in hi)) problems.push(`missing in hi: ${key}`);
  else if (names(en[key]) !== names(hi[key])) problems.push(`placeholders differ: ${key} (en {${names(en[key])}} / hi {${names(hi[key])}})`);
}
for (const key of Object.keys(hi)) if (!(key in en)) problems.push(`extra in hi: ${key}`);

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`i18n: ${Object.keys(en).length} keys, en and hi agree.`);
