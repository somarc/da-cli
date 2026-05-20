import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { listContentPaths } from './paths.js';
import { simpleDiff } from './mutation.js';

const CONTENT_DIR = 'content';
const STATE_FILE = path.join('.da', 'content-state.json');

export async function cloneWorkspace(client, { rootPath = '/', force = false } = {}) {
  if (existsSync(CONTENT_DIR)) {
    if (!force) throw new Error('content/ already exists. Pass --force to replace it.');
    await rm(CONTENT_DIR, { recursive: true, force: true });
  }
  await mkdir(CONTENT_DIR, { recursive: true });
  const paths = await listContentPaths(client, rootPath);
  const files = {};
  for (const daPath of paths) {
    const res = await client.sourceGet(daPath);
    const text = await res.text();
    const localPath = toLocalPath(daPath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, text, 'utf8');
    files[daPath] = { hash: hash(text) };
  }
  await writeState({ rootPath, files, staged: [], commits: [] });
  return { files: paths.length };
}

export async function workspaceStatus() {
  const state = await readState();
  const localPaths = await listLocalFiles();
  const all = new Set([...Object.keys(state.files), ...localPaths.map(toDaPath)]);
  const rows = [];
  for (const daPath of [...all].sort()) {
    const base = state.files[daPath];
    const localPath = toLocalPath(daPath);
    const exists = existsSync(localPath);
    const currentHash = exists ? hash(await readFile(localPath, 'utf8')) : null;
    let status = 'unchanged';
    if (!base && exists) status = 'added';
    else if (base && !exists) status = 'deleted';
    else if (base?.hash !== currentHash) status = 'modified';
    if (status !== 'unchanged') rows.push({ status, staged: state.staged.includes(daPath) ? 'yes' : '', path: daPath });
  }
  return rows;
}

export async function workspaceDiff(client, daPath) {
  const state = await readState();
  const targets = daPath ? [normalizeDaPath(daPath)] : (await workspaceStatus()).map((r) => r.path);
  const chunks = [];
  for (const target of targets) {
    const localPath = toLocalPath(target);
    const local = existsSync(localPath) ? await readFile(localPath, 'utf8') : '';
    let remote = '';
    if (state.files[target]) {
      const res = await client.sourceGet(target);
      remote = await res.text();
    }
    chunks.push(`Diff for ${target}:\n${simpleDiff(remote, local)}`);
  }
  return chunks.join('\n\n');
}

export async function stage(paths = []) {
  const state = await readState();
  const changed = (await workspaceStatus()).map((r) => r.path);
  const requested = paths.length ? paths.map(toDaPath) : changed;
  state.staged = [...new Set([...state.staged, ...requested.filter((p) => changed.includes(p))])].sort();
  await writeState(state);
  return state.staged;
}

export async function commitWorkspace(message) {
  const state = await readState();
  if (!state.staged.length) throw new Error('nothing staged');
  state.commits.push({ id: crypto.randomBytes(4).toString('hex'), message, paths: state.staged, createdAt: new Date().toISOString() });
  state.staged = [];
  await writeState(state);
  return state.commits.at(-1);
}

export async function pushWorkspace(client, { path: scope, force = false, dryRun = false } = {}) {
  const state = await readState();
  const changed = await workspaceStatus();
  const committed = new Set(state.commits.flatMap((c) => c.paths));
  const targets = changed
    .map((r) => r.path)
    .filter((p) => !scope || p === normalizeDaPath(scope) || p.startsWith(`${normalizeDaPath(scope).replace(/\/$/, '')}/`));
  const uncommitted = targets.filter((p) => !committed.has(p));
  if (uncommitted.length && !force) throw new Error(`uncommitted changes: ${uncommitted.join(', ')}`);
  if (dryRun) return { pushed: 0, planned: targets };
  for (const daPath of targets) {
    const localPath = toLocalPath(daPath);
    if (existsSync(localPath)) {
      const text = await readFile(localPath, 'utf8');
      await client.sourcePut(daPath, text);
      state.files[daPath] = { hash: hash(text) };
    } else {
      await client.sourceDelete(daPath);
      delete state.files[daPath];
    }
  }
  state.staged = state.staged.filter((p) => !targets.includes(p));
  state.commits = [];
  await writeState(state);
  return { pushed: targets.length, planned: targets };
}

export async function mergeWorkspace(client, daPath) {
  const state = await readState();
  const targets = daPath ? [normalizeDaPath(daPath)] : Object.keys(state.files);
  for (const target of targets) {
    const res = await client.sourceGet(target);
    const text = await res.text();
    const localPath = toLocalPath(target);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, text, 'utf8');
    state.files[target] = { hash: hash(text) };
  }
  await writeState(state);
  return { merged: targets.length };
}

async function readState() {
  if (!existsSync(STATE_FILE)) throw new Error('no local content workspace. Run `da content clone --path /` first.');
  return JSON.parse(await readFile(STATE_FILE, 'utf8'));
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function listLocalFiles(dir = CONTENT_DIR) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listLocalFiles(p));
    else out.push(p);
  }
  return out;
}

function toLocalPath(daPath) {
  return path.join(CONTENT_DIR, normalizeDaPath(daPath).replace(/^\//, ''));
}

function toDaPath(localPath) {
  if (localPath.startsWith(CONTENT_DIR)) return normalizeDaPath(path.relative(CONTENT_DIR, localPath));
  return normalizeDaPath(localPath);
}

function normalizeDaPath(p) {
  return `/${String(p).replace(/^content\//, '').replace(/^\//, '')}`;
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
