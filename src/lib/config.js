import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInterface } from 'node:readline/promises';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.da', 'config.json');
const PROJECT_CONFIG_FILE = '.da.json';

async function readJson(p) {
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeJson(p, data) {
  const dir = path.dirname(p);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function findProjectConfig(start = process.cwd()) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, PROJECT_CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function resolveConfig(overrides = {}) {
  const global = await readJson(GLOBAL_CONFIG_PATH);
  const projectPath = findProjectConfig();
  const project = projectPath ? await readJson(projectPath) : {};

  const resolved = { ...global, ...project };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null) resolved[k] = v;
  }

  return {
    org: resolved.org,
    repo: resolved.repo,
    env: resolved.env ?? 'prod',
    config: resolved,
    sources: {
      org: overrides.org != null ? 'flag' : project.org != null ? 'project' : global.org != null ? 'global' : 'unset',
      repo: overrides.repo != null ? 'flag' : project.repo != null ? 'project' : global.repo != null ? 'global' : 'unset',
      env: overrides.env != null ? 'flag' : project.env != null ? 'project' : global.env != null ? 'global' : 'default',
    },
  };
}

export async function getConfigValue(key, scope = 'resolved') {
  const { config } = await resolveConfig();
  return config[key];
}

export async function setConfigValue(key, value, { global: useGlobal = false } = {}) {
  const targetPath = useGlobal ? GLOBAL_CONFIG_PATH : (() => {
    const existing = findProjectConfig();
    return existing ?? path.join(process.cwd(), PROJECT_CONFIG_FILE);
  })();
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

export function projectConfigFile() {
  return PROJECT_CONFIG_FILE;
}
