import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';
import { getGlobals } from './context.js';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.da', 'config.json');
const PROJECT_CONFIG_FILE = '.da.json';

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
//   command-local overrides > root CLI flags > project .da.json > ~/.da/config.json
export async function resolveConfig(overrides = {}) {
  const globals = getGlobals();
  const globalCfg = await readJson(GLOBAL_CONFIG_PATH);
  const projectPath = findProjectConfig();
  const projectCfg = projectPath ? await readJson(projectPath) : {};

  const base = { ...globalCfg, ...projectCfg };

  // Root-level CLI flags take precedence over config files
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
      : projectCfg.org != null ? 'project'
      : globalCfg.org != null ? 'global'
      : 'unset',
    repo: overrides.repo != null ? 'override'
      : globals.repo != null ? 'flag'
      : projectCfg.repo != null ? 'project'
      : globalCfg.repo != null ? 'global'
      : 'unset',
    env: overrides.env != null ? 'override'
      : globals.env != null ? 'flag'
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
