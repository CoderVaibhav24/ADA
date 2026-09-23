// Regenerates @ada/api-types: dumps the OpenAPI specs from source, then runs openapi-typescript.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const venvPython = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
// CI installs the services into the runner's Python rather than a .venv.
const python = process.env.ADA_PYTHON ?? (existsSync(venvPython) ? venvPython : 'python3');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execFileSync(python, [resolve(root, 'scripts/dump_openapi.py')], { cwd: root, stdio: 'inherit' });
execFileSync(npm, ['run', 'generate', '-w', '@ada/api-types'], { cwd: root, stdio: 'inherit' });
