import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { getGlobals } from './context.js';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.da', 'config.json');
const PROJECT_CONFIG_FILE = '.da.json';
let dotEnvLoaded = false;

export function loadDotEnv(start = process.cwd()) {
  if (dotEnvLoaded) return;
  dotEnvLoaded = true;
  const file = findUp('.env', start);
  if (!file) return;
  let text = '';
  try {
    text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnv(rawValue.trim());
  }
}

function unquoteEnv(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function findUp(name, start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function readJson(p) {
  let raw;
  try {
    raw = await readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new Error(`Cannot read config file ${p}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed JSON in config file ${p}: ${err.message}`);
  }
}

async function writeJson(p, data) {
  const dir = path.dirname(p);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function findProjectConfig(start = process.cwd()) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, PROJECT_CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Resolves config in precedence order:
//   command-local overrides > root CLI flags > env > project .da.json > ~/.da/config.json
export async function resolveConfig(overrides = {}) {
  loadDotEnv();
  const globals = getGlobals();
  const globalCfg = await readJson(GLOBAL_CONFIG_PATH);
  const projectPath = findProjectConfig();
  const projectCfg = projectPath ? await readJson(projectPath) : {};

  const base = { ...globalCfg, ...projectCfg };
  const envCfg = readEnvConfig();

  // Root-level CLI flags take precedence over config files
  Object.assign(base, envCfg);
  if (globals.org) base.org = globals.org;
  if (globals.repo) base.repo = globals.repo;
  if (globals.env) base.env = globals.env;

  // Command-local overrides are highest precedence
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null) base[k] = v;
  }

  const sources = {
    org: overrides.org != null ? 'override'
      : globals.org != null ? 'flag'
      : envCfg.org != null ? 'env'
      : projectCfg.org != null ? 'project'
      : globalCfg.org != null ? 'global'
      : 'unset',
    repo: overrides.repo != null ? 'override'
      : globals.repo != null ? 'flag'
      : envCfg.repo != null ? 'env'
      : projectCfg.repo != null ? 'project'
      : globalCfg.repo != null ? 'global'
      : 'unset',
    env: overrides.env != null ? 'override'
      : globals.env != null ? 'flag'
      : envCfg.env != null ? 'env'
      : projectCfg.env != null ? 'project'
      : globalCfg.env != null ? 'global'
      : 'default',
  };

  return {
    org: base.org,
    repo: base.repo,
    env: base.env ?? 'prod',
    config: base,
    sources,
    projectConfigPath: projectPath,
    globalConfigPath: GLOBAL_CONFIG_PATH,
  };
}

function envValue(...keys) {
  for (const key of keys) {
    if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
  }
  return undefined;
}

function readEnvConfig() {
  return Object.fromEntries(Object.entries({
    org: envValue('DA_ORG', 'AEM_ORG'),
    repo: envValue('DA_REPO', 'AEM_REPO'),
    env: envValue('DA_ENV', 'AEM_ENV'),
    branch: envValue('DA_BRANCH', 'AEM_BRANCH'),
  }).filter(([, value]) => value !== undefined));
}

export async function getConfigValue(key) {
  const { config } = await resolveConfig();
  return config[key];
}

export async function setConfigValue(key, value, { global: useGlobal = false } = {}) {
  const targetPath = useGlobal
    ? GLOBAL_CONFIG_PATH
    : (findProjectConfig() ?? path.join(process.cwd(), PROJECT_CONFIG_FILE));
  const data = await readJson(targetPath);
  data[key] = value;
  await writeJson(targetPath, data);
  return targetPath;
}

export async function initConfig({ global: useGlobal = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const { config: existing } = await resolveConfig();
    const org = await rl.question(`DA org [${existing.org ?? ''}]: `);
    const repo = await rl.question(`DA repo [${existing.repo ?? ''}]: `);
    const env = await rl.question(`Environment (dev/stage/prod) [${existing.env ?? 'prod'}]: `);

    const data = {};
    if (org.trim()) data.org = org.trim();
    if (repo.trim()) data.repo = repo.trim();
    if (env.trim()) data.env = env.trim();

    const targetPath = useGlobal
      ? GLOBAL_CONFIG_PATH
      : path.join(process.cwd(), PROJECT_CONFIG_FILE);

    const current = await readJson(targetPath);
    await writeJson(targetPath, { ...current, ...data });
    return targetPath;
  } finally {
    rl.close();
  }
}

export function globalConfigPath() {
  return GLOBAL_CONFIG_PATH;
}
