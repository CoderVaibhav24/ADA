#!/usr/bin/env node
// Publishes, rolls back and lists over-the-air updates for the self-hosted server in infra/ota/.
//
//   node scripts/publish-update.mjs publish  [--platform android|ios|all] [--channel C] [--message M]
//   node scripts/publish-update.mjs rollback [--platform P] [--channel C] [--to RELEASE_ID | --embedded]
//                                            [--runtime-version RV]
//   node scripts/publish-update.mjs list     [--platform P] [--channel C] [--runtime-version RV]
//
// Run it with the SAME environment the binary was built with (ACTIVE_ENV in ada.config.ts,
// or EXPO_PUBLIC_ADA_ENV, plus APP_VARIANT, ADA_OTA_URL, EXPO_PUBLIC_*): the runtime version
// is a fingerprint of the resolved config and native tree, so switching env changes it and
// the update would never be offered to the installed binary.
//
// Signing happens here, not on the server: every manifest and directive is signed with
// the private key in infra/secrets/ota/, which is checked against the certificate
// embedded in the app before anything is written.

import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash, createPrivateKey, createPublicKey, createSign, randomBytes } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAdaConfig } from '../ada.config.ts';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(APP_ROOT, '..');
const CERTIFICATE = path.join(APP_ROOT, 'certs', 'ota-code-signing.crt');
const KEY_ID = 'main';
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(message) {
  console.error(`publish-update: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) fail(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }
  return { command, flags };
}

// Mirrors app.config.ts: channel = ADA_UPDATE_CHANNEL, else the resolved build variant.
function defaultChannel() {
  if (process.env.ADA_UPDATE_CHANNEL) return process.env.ADA_UPDATE_CHANNEL;
  return resolveAdaConfig().appVariant;
}

// Asset URLs in a signed manifest are absolute, so the public origin is fixed at publish time.
function defaultPublicUrl() {
  if (process.env.ADA_OTA_PUBLIC_URL) return process.env.ADA_OTA_PUBLIC_URL;
  return new URL(resolveAdaConfig().otaUrl).origin;
}

function settings(flags) {
  const platformFlag = flags.platform ?? 'all';
  const platforms = platformFlag === 'all' ? ['android', 'ios'] : [platformFlag];
  for (const p of platforms) if (p !== 'android' && p !== 'ios') fail(`unknown platform ${p}`);
  const channel = typeof flags.channel === 'string' ? flags.channel : defaultChannel();
  if (!SAFE_SEGMENT.test(channel)) fail(`bad channel ${channel}`);
  return {
    platforms,
    channel,
    updatesDir: path.resolve(process.env.ADA_OTA_UPDATES_DIR ?? path.join(REPO_ROOT, 'data', 'ota-updates')),
    keyPath: path.resolve(
      process.env.ADA_OTA_SIGNING_KEY ?? path.join(REPO_ROOT, 'infra', 'secrets', 'ota', 'private-key.pem'),
    ),
    publicUrl: (typeof flags['public-url'] === 'string' ? flags['public-url'] : defaultPublicUrl()).replace(/\/+$/, ''),
  };
}

// Loads the signing key and refuses it unless it is the key the app's certificate trusts.
async function loadSigningKey(keyPath) {
  if (!existsSync(keyPath)) {
    fail(`signing key not found at ${keyPath}. It lives in infra/secrets/ota/ (gitignored); see app/README.md.`);
  }
  const key = createPrivateKey(await fs.readFile(keyPath, 'utf8'));
  const certificate = new X509Certificate(await fs.readFile(CERTIFICATE, 'utf8'));
  const fromKey = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const fromCert = certificate.publicKey.export({ type: 'spki', format: 'der' });
  if (!fromKey.equals(fromCert)) {
    fail(`${keyPath} does not match ${CERTIFICATE}. Every handset would reject this update.`);
  }
  if (new Date(certificate.validTo) < new Date()) fail(`${CERTIFICATE} has expired.`);
  return key;
}

function signatureHeader(key, body) {
  const signer = createSign('RSA-SHA256');
  signer.update(body, 'utf8');
  return `sig="${signer.sign(key, 'base64')}", keyid="${KEY_ID}"`;
}

async function writeSigned(file, key, value) {
  const body = JSON.stringify(value);
  await fs.writeFile(`${file}.sig`, signatureHeader(key, body));
  await fs.writeFile(file, body);
}

// Write-then-rename, so the server never reads a half-written pointer.
async function writeAtomic(file, contents) {
  const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, contents);
  await fs.rename(temp, file);
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: APP_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function resolveRuntimeVersion(platform) {
  const output = run('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', platform]);
  const { runtimeVersion } = JSON.parse(output);
  if (typeof runtimeVersion !== 'string' || runtimeVersion === '') {
    fail(`could not resolve the ${platform} runtime version`);
  }
  return runtimeVersion;
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: APP_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'nogit';
  }
}

function newReleaseId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${gitCommit()}-${randomBytes(2).toString('hex')}`;
}

function uuidFrom(text) {
  const hex = createHash('sha256').update(text).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
};

async function assetEntry(releaseDir, relPath, ext, assetBase, isLaunch) {
  const data = await fs.readFile(path.join(releaseDir, relPath));
  return {
    hash: createHash('sha256').update(data).digest('base64url'),
    key: createHash('md5').update(data).digest('hex'),
    fileExtension: isLaunch ? '.bundle' : `.${ext}`,
    contentType: isLaunch ? 'application/javascript' : (CONTENT_TYPES[ext] ?? 'application/octet-stream'),
    url: `${assetBase}/${relPath.split('/').map(encodeURIComponent).join('/')}`,
  };
}

// Builds and signs the manifest for a release directory that already holds an export.
async function sealRelease({ releaseDir, releaseId, platform, runtimeVersion, channel, publicUrl, key, release }) {
  const metadataRaw = await fs.readFile(path.join(releaseDir, 'metadata.json'), 'utf8');
  const fileMetadata = JSON.parse(metadataRaw).fileMetadata?.[platform];
  if (!fileMetadata) fail(`export has no ${platform} bundle`);
  const expoClient = JSON.parse(await fs.readFile(path.join(releaseDir, 'expoConfig.json'), 'utf8'));

  const segments = [platform, runtimeVersion, channel, releaseId].map(encodeURIComponent).join('/');
  const assetBase = `${publicUrl}/api/assets/${segments}`;
  const manifest = {
    id: uuidFrom(`${releaseId}:${metadataRaw}`),
    createdAt: release.publishedAt,
    runtimeVersion,
    launchAsset: await assetEntry(releaseDir, fileMetadata.bundle, null, assetBase, true),
    assets: await Promise.all(
      (fileMetadata.assets ?? []).map((a) => assetEntry(releaseDir, a.path, a.ext, assetBase, false)),
    ),
    metadata: { channel, releaseId },
    // Constants.expoConfig in the updated app; services/config/env.ts reads extra.ada from it.
    extra: { expoClient },
  };
  const sealed = { ...release, updateId: manifest.id };
  await fs.writeFile(path.join(releaseDir, 'release.json'), `${JSON.stringify(sealed, null, 2)}\n`);
  await writeSigned(path.join(releaseDir, 'manifest.json'), key, manifest);
  return manifest;
}

async function ensureNoUpdateDirective(updatesDir, key) {
  await fs.mkdir(updatesDir, { recursive: true });
  await writeSigned(path.join(updatesDir, 'no-update.directive.json'), key, { type: 'noUpdateAvailable' });
}

async function pointAt(channelDir, target, note) {
  await writeAtomic(path.join(channelDir, 'current'), `${target}\n`);
  await fs.appendFile(path.join(channelDir, 'history.log'), `${new Date().toISOString()}\t${target}\t${note}\n`);
}

async function readCurrent(channelDir) {
  try {
    return (await fs.readFile(path.join(channelDir, 'current'), 'utf8')).trim();
  } catch {
    return null;
  }
}

async function listReleases(channelDir) {
  const dir = path.join(channelDir, 'releases');
  if (!existsSync(dir)) return [];
  const names = (await fs.readdir(dir)).filter((name) => !name.startsWith('.'));
  const releases = [];
  for (const name of names) {
    try {
      releases.push(JSON.parse(await fs.readFile(path.join(dir, name, 'release.json'), 'utf8')));
    } catch {
      // Never sealed: not offered, not listed.
    }
  }
  return releases.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}

async function publish(flags) {
  const cfg = settings(flags);
  const key = await loadSigningKey(cfg.keyPath);
  await ensureNoUpdateDirective(cfg.updatesDir, key);
  const message = typeof flags.message === 'string' ? flags.message : '';
  const expoConfig = run('npx', ['expo', 'config', '--json', '--type', 'public']);

  for (const platform of cfg.platforms) {
    const runtimeVersion = resolveRuntimeVersion(platform);
    const channelDir = path.join(cfg.updatesDir, platform, runtimeVersion, cfg.channel);
    const releaseId = newReleaseId();
    const staging = path.join(channelDir, 'releases', `.staging-${releaseId}`);
    const exportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ada-ota-'));

    console.log(`[${platform}] runtime ${runtimeVersion}, channel ${cfg.channel}: exporting`);
    run('npx', ['expo', 'export', '--platform', platform, '--output-dir', exportDir]);

    await fs.mkdir(path.dirname(staging), { recursive: true });
    await fs.cp(exportDir, staging, { recursive: true });
    await fs.rm(exportDir, { recursive: true, force: true });
    await fs.writeFile(path.join(staging, 'expoConfig.json'), expoConfig);

    const manifest = await sealRelease({
      releaseDir: staging,
      releaseId,
      platform,
      runtimeVersion,
      channel: cfg.channel,
      publicUrl: cfg.publicUrl,
      key,
      release: {
        releaseId,
        publishedAt: new Date().toISOString(),
        message,
        gitCommit: gitCommit(),
        rolledBackFrom: null,
      },
    });
    await fs.rename(staging, path.join(channelDir, 'releases', releaseId));
    await pointAt(channelDir, releaseId, `publish ${message}`);
    console.log(`[${platform}] live: ${releaseId} (update ${manifest.id})`);
  }
}

function runtimeVersionFor(flags, platform) {
  return typeof flags['runtime-version'] === 'string' ? flags['runtime-version'] : resolveRuntimeVersion(platform);
}

async function rollback(flags) {
  const cfg = settings(flags);
  const key = await loadSigningKey(cfg.keyPath);
  await ensureNoUpdateDirective(cfg.updatesDir, key);

  for (const platform of cfg.platforms) {
    const runtimeVersion = runtimeVersionFor(flags, platform);
    if (!SAFE_SEGMENT.test(runtimeVersion)) fail(`bad runtime version ${runtimeVersion}`);
    const channelDir = path.join(cfg.updatesDir, platform, runtimeVersion, cfg.channel);
    if (!existsSync(channelDir)) {
      fail(`[${platform}] nothing published for runtime ${runtimeVersion} on ${cfg.channel}`);
    }

    if (flags.embedded === true) {
      // Handsets drop downloaded updates and run the JS they were installed with.
      await writeSigned(path.join(channelDir, 'rollback.directive.json'), key, {
        type: 'rollBackToEmbedded',
        parameters: { commitTime: new Date().toISOString() },
      });
      await pointAt(channelDir, 'embedded', 'rollback to embedded');
      console.log(`[${platform}] rolled back to the embedded bundle`);
      continue;
    }

    const current = await readCurrent(channelDir);
    const releases = await listReleases(channelDir);
    let targetId = typeof flags.to === 'string' ? flags.to : null;
    if (targetId === null) {
      // The release before the live one. If nothing is live, the newest release.
      const index = releases.findIndex((r) => r.releaseId === current);
      const before = index === -1 ? releases : releases.slice(0, index);
      targetId = before.at(-1)?.releaseId ?? null;
      if (targetId === null) fail(`[${platform}] no earlier release to roll back to; use --embedded`);
    }
    const target = releases.find((r) => r.releaseId === targetId);
    if (!target) fail(`[${platform}] release ${targetId} not found`);

    /*
     * Re-published under a new id and createdAt. A handset running the bad update
     * only accepts something newer than it, so re-pointing at the old manifest
     * as-is would be ignored by exactly the handsets that need the rollback.
     */
    const releaseId = newReleaseId();
    const staging = path.join(channelDir, 'releases', `.staging-${releaseId}`);
    await fs.cp(path.join(channelDir, 'releases', targetId), staging, { recursive: true });
    await Promise.all(
      ['manifest.json', 'manifest.json.sig', 'release.json'].map((f) => fs.rm(path.join(staging, f), { force: true })),
    );
    const manifest = await sealRelease({
      releaseDir: staging,
      releaseId,
      platform,
      runtimeVersion,
      channel: cfg.channel,
      publicUrl: cfg.publicUrl,
      key,
      release: {
        releaseId,
        publishedAt: new Date().toISOString(),
        message: `rollback to ${targetId}`,
        gitCommit: target.gitCommit,
        rolledBackFrom: current,
      },
    });
    await fs.rename(staging, path.join(channelDir, 'releases', releaseId));
    await pointAt(channelDir, releaseId, `rollback to ${targetId}`);
    console.log(`[${platform}] live: ${releaseId}, a copy of ${targetId} (update ${manifest.id})`);
  }
}

async function list(flags) {
  const cfg = settings(flags);
  for (const platform of cfg.platforms) {
    const runtimeVersion = runtimeVersionFor(flags, platform);
    const channelDir = path.join(cfg.updatesDir, platform, runtimeVersion, cfg.channel);
    const current = await readCurrent(channelDir);
    console.log(`[${platform}] runtime ${runtimeVersion}, channel ${cfg.channel}, live: ${current ?? '(nothing)'}`);
    for (const r of await listReleases(channelDir)) {
      const marker = r.releaseId === current ? '*' : ' ';
      console.log(` ${marker} ${r.releaseId}  ${r.publishedAt}  ${r.gitCommit}  ${r.message}`);
    }
  }
}

const { command, flags } = parseArgs(process.argv.slice(2));
const commands = { publish, rollback, list };
if (!Object.hasOwn(commands, command ?? '')) {
  fail('usage: publish-update.mjs <publish|rollback|list> [flags]; see the header of this file');
}
await commands[command](flags);
