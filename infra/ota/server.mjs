// ADA ICMS self-hosted update server: Expo Updates protocol v1, Node built-ins only.
//
// This server holds no signing key. Every manifest and directive it returns was
// signed on the publisher's machine by apps/field/scripts/publish-update.mjs, and the
// app's embedded certificate rejects anything else. Whoever controls this host can
// withhold updates or replay an older signed one; they cannot ship new code.
//
// Layout under UPDATES_DIR (written only by the publish script):
//
//   no-update.directive.json, .sig           signed {"type":"noUpdateAvailable"}
//   <platform>/<runtimeVersion>/<channel>/
//     current                                one line: a release id, or "embedded"
//     rollback.directive.json, .sig          signed rollBackToEmbedded, when current = embedded
//     releases/<releaseId>/
//       manifest.json, manifest.json.sig     exact bytes served, and their signature
//       metadata.json, _expo/…, assets/…     the `expo export` output the manifest points at
//       release.json                         who published what, when
//
// Endpoints
//   GET /api/manifest   expo-protocol-version: 1, expo-platform, expo-runtime-version,
//                       expo-channel-name (all required)
//   GET /api/assets/<platform>/<runtimeVersion>/<channel>/<releaseId>/<path>
//   GET /health

import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8020);
const UPDATES_DIR = path.resolve(process.env.UPDATES_DIR ?? './updates');

const PLATFORMS = new Set(['android', 'ios']);
// Runtime versions are fingerprints (hex); channels and release ids are short names.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function log(fields) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...fields })}\n`);
}

function sendError(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

// Reads a pre-signed body and its signature header value. Null when either is missing.
async function readSigned(file) {
  try {
    const [body, signature] = await Promise.all([
      fs.readFile(file, 'utf8'),
      fs.readFile(`${file}.sig`, 'utf8'),
    ]);
    return { body, signature: signature.trim() };
  } catch {
    return null;
  }
}

// multipart/mixed, one JSON part per entry, the signature on the part it covers.
function sendMultipart(res, parts) {
  const boundary = `ada-${randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push('content-type: application/json; charset=utf-8\r\n');
    chunks.push(`content-disposition: form-data; name="${part.name}"\r\n`);
    if (part.signature) chunks.push(`expo-signature: ${part.signature}\r\n`);
    chunks.push(`\r\n${part.body}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  res.writeHead(200, {
    'expo-protocol-version': '1',
    'expo-sfv-version': '0',
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${boundary}`,
  });
  res.end(chunks.join(''));
}

async function sendDirective(res, file) {
  const signed = await readSigned(file);
  if (signed === null) return sendError(res, 503, 'no signed directive published yet');
  return sendMultipart(res, [{ name: 'directive', body: signed.body, signature: signed.signature }]);
}

async function readCurrent(channelDir) {
  try {
    return (await fs.readFile(path.join(channelDir, 'current'), 'utf8')).trim();
  } catch {
    return null;
  }
}

async function handleManifest(req, res) {
  const protocolVersion = Number(req.headers['expo-protocol-version'] ?? 0);
  const platform = req.headers['expo-platform'];
  const runtimeVersion = req.headers['expo-runtime-version'];
  const channel = req.headers['expo-channel-name'];

  if (protocolVersion !== 1) return sendError(res, 400, 'expo-protocol-version must be 1');
  if (!PLATFORMS.has(platform)) return sendError(res, 400, 'expo-platform must be android or ios');
  if (!SAFE_SEGMENT.test(runtimeVersion ?? '')) return sendError(res, 400, 'bad expo-runtime-version');
  if (!SAFE_SEGMENT.test(channel ?? '')) return sendError(res, 400, 'bad or missing expo-channel-name');

  const channelDir = path.join(UPDATES_DIR, platform, runtimeVersion, channel);
  const current = await readCurrent(channelDir);
  const context = { platform, runtimeVersion, channel, current };

  if (current === null) {
    log({ event: 'manifest', result: 'no_update', ...context });
    return sendDirective(res, path.join(UPDATES_DIR, 'no-update.directive.json'));
  }

  if (current === 'embedded') {
    log({ event: 'manifest', result: 'roll_back_to_embedded', ...context });
    return sendDirective(res, path.join(channelDir, 'rollback.directive.json'));
  }

  if (!SAFE_SEGMENT.test(current)) return sendError(res, 500, 'corrupt current pointer');

  const signed = await readSigned(path.join(channelDir, 'releases', current, 'manifest.json'));
  if (signed === null) return sendError(res, 500, `release ${current} has no signed manifest`);

  const { id } = JSON.parse(signed.body);
  if (req.headers['expo-current-update-id'] === id) {
    log({ event: 'manifest', result: 'already_current', id, ...context });
    return sendDirective(res, path.join(UPDATES_DIR, 'no-update.directive.json'));
  }

  log({ event: 'manifest', result: 'update', id, ...context });
  return sendMultipart(res, [
    { name: 'manifest', body: signed.body, signature: signed.signature },
    { name: 'extensions', body: JSON.stringify({ assetRequestHeaders: {} }) },
  ]);
}

const CONTENT_TYPES = {
  hbc: 'application/javascript',
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

async function handleAsset(req, res, rest) {
  let segments;
  try {
    segments = rest.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return sendError(res, 400, 'bad asset path');
  }
  const [platform, runtimeVersion, channel, releaseId, ...fileParts] = segments;
  const valid =
    PLATFORMS.has(platform) && [runtimeVersion, channel, releaseId].every((s) => SAFE_SEGMENT.test(s ?? ''));
  if (!valid || fileParts.length === 0) return sendError(res, 400, 'bad asset path');

  const releaseDir = path.join(UPDATES_DIR, platform, runtimeVersion, channel, 'releases', releaseId);
  const file = path.resolve(releaseDir, ...fileParts);
  // The resolved file must stay inside its release: no traversal, and no serving the signatures.
  if (!file.startsWith(`${releaseDir}${path.sep}`)) return sendError(res, 400, 'bad asset path');

  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return sendError(res, 404, 'asset not found');
  }
  if (!stat.isFile()) return sendError(res, 404, 'asset not found');

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    // Content-addressed inside an immutable release.
    'cache-control': 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const done = (promise) =>
    promise.catch((error) => {
      log({ event: 'error', path: url.pathname, message: error.message });
      if (!res.headersSent) sendError(res, 500, 'internal error');
      else res.destroy();
    });

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method not allowed');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  if (url.pathname === '/api/manifest') return done(handleManifest(req, res));
  if (url.pathname.startsWith('/api/assets/')) {
    return done(handleAsset(req, res, url.pathname.slice('/api/assets/'.length)));
  }
  return sendError(res, 404, 'not found');
});

server.listen(PORT, () => log({ event: 'listening', port: PORT, updatesDir: UPDATES_DIR }));
