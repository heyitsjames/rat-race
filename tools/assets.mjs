#!/usr/bin/env node
// Move the original assets between this checkout and a private R2 bucket, so
// they never live in git.
//
//   npm run assets:upload   pack the assets made by `npm run extract`, upload the
//                           archive, and record it in assets.lock (commit that)
//   npm run assets:fetch    download the archive named in assets.lock, check its
//                           SHA-256 and unpack it (this is what deploys run)
//
// Fetching uses R2's S3 API when R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are
// set (the Cloudflare Pages build), otherwise your `wrangler login`.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCK = path.join(ROOT, 'assets.lock');
const STAMP = path.join(ROOT, 'public/assets/rat-race/.archive-sha256');
// Everything that comes from the original software (plus the link preview
// image, which is a screenshot of it). Paths are relative to the repo root.
const CONTENTS = ['public/assets/rat-race', 'reference/STFT_110.bin', 'public/og-image.jpg'];
const DEFAULTS = { accountId: '134992a953409ace90593eea2ca21fc1', bucket: 'rat-race-assets' };

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (msg) => {
  console.error(`assets: ${msg}`);
  process.exit(1);
};
const wrangler = (args) => execFileSync('npx', ['-y', 'wrangler@4', ...args], { stdio: 'inherit', cwd: ROOT });

function readLock() {
  if (!fs.existsSync(LOCK)) fail('assets.lock is missing; run `npm run assets:upload` first');
  return JSON.parse(fs.readFileSync(LOCK, 'utf8'));
}

function upload() {
  const missing = CONTENTS.filter((p) => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length) fail(`missing ${missing.join(', ')}; run \`npm run extract\` first`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-race-assets-'));
  const archive = path.join(tmp, 'assets.tar.gz');
  execFileSync('tar', ['-czf', archive, '--exclude', '.archive-sha256', '--exclude', '.DS_Store', ...CONTENTS], {
    cwd: ROOT,
    env: { ...process.env, COPYFILE_DISABLE: '1' }, // no macOS ._ files
  });
  const hash = sha256(archive);
  const lock = fs.existsSync(LOCK) ? readLock() : DEFAULTS;
  const key = `rat-race-assets-${hash.slice(0, 16)}.tar.gz`;
  wrangler(['r2', 'object', 'put', `${lock.bucket}/${key}`, '--file', archive, '--remote']);
  const next = { accountId: lock.accountId, bucket: lock.bucket, key, sha256: hash };
  fs.writeFileSync(LOCK, `${JSON.stringify(next, null, 2)}\n`);
  fs.writeFileSync(STAMP, hash);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`uploaded ${key} (sha256 ${hash}); commit assets.lock`);
}

async function download(lock, archive) {
  const { R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (accessKeyId && secretAccessKey) {
    const { AwsClient } = await import('aws4fetch');
    const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
    const url = `https://${lock.accountId}.r2.cloudflarestorage.com/${lock.bucket}/${lock.key}`;
    const res = await client.fetch(url);
    if (!res.ok) fail(`download failed: HTTP ${res.status} ${await res.text()}`);
    fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  } else {
    console.log('assets: no R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY set, using `wrangler login`');
    wrangler(['r2', 'object', 'get', `${lock.bucket}/${lock.key}`, '--file', archive, '--remote']);
  }
}

async function fetchAssets() {
  const lock = readLock();
  if (fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === lock.sha256) {
    console.log('assets: already up to date');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rat-race-assets-'));
  const archive = path.join(tmp, 'assets.tar.gz');
  await download(lock, archive);
  const got = sha256(archive);
  if (got !== lock.sha256) fail(`downloaded archive has SHA-256 ${got}, expected ${lock.sha256}`);
  fs.rmSync(path.join(ROOT, 'public/assets/rat-race'), { recursive: true, force: true });
  execFileSync('tar', ['-xzf', archive, '-C', ROOT]);
  fs.writeFileSync(STAMP, got);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`assets: unpacked ${lock.key}`);
}

// Runs before dev, build and test, to explain missing assets instead of
// letting Vite or TypeScript fail on an import.
function check() {
  const missing = CONTENTS.filter((p) => p !== 'public/og-image.jpg' && !fs.existsSync(path.join(ROOT, p)));
  if (!missing.length) return;
  fail(
    `the original After Dark assets are missing (${missing.join(', ')}).\n` +
      '  Get them with one of:\n' +
      '    npm run assets:fetch                                   (from the private R2 bucket)\n' +
      '    npm run extract -- "<path to After Dark 4.94 Collection>"  (from the original files)\n' +
      '  See "Getting the assets" in the README.',
  );
}

const cmd = process.argv[2];
if (cmd === 'upload') upload();
else if (cmd === 'fetch') await fetchAssets();
else if (cmd === 'check') check();
else fail('usage: node tools/assets.mjs upload|fetch|check');
