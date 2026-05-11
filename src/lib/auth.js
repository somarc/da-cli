import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const TOKEN_PATH = path.join(os.homedir(), '.aem', 'da-token.json');

export function tokenPath() {
  return TOKEN_PATH;
}

async function readCache() {
  try {
    const raw = await readFile(TOKEN_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getToken({ refresh = false } = {}) {
  if (!refresh) {
    const cached = await readCache();
    if (cached?.access_token && cached.expires_at > Date.now() + 30_000) {
      return cached.access_token;
    }
  }

  // Obtain fresh token via da-auth-helper
  const result = spawnSync('npx', ['github:adobe-rnd/da-auth-helper', 'token'], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error(`da-auth-helper failed: ${result.stderr?.trim() || 'unknown error'}`);
  }

  const token = result.stdout.trim();
  if (!token) throw new Error('da-auth-helper returned empty token');

  // Write cache via Python — node subshell env-var inheritance is unreliable
  const expires_at = Date.now() + 3_600_000;
  const cacheDir = path.dirname(TOKEN_PATH);
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  const py = `import json; open(r'${TOKEN_PATH}', 'w').write(json.dumps({'access_token': r'${token}', 'expires_at': ${expires_at}}))`;
  const pyResult = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
  if (pyResult.status !== 0) {
    throw new Error(`Failed to write token cache: ${pyResult.stderr?.trim()}`);
  }

  return token;
}

export async function clearToken() {
  const { unlink } = await import('node:fs/promises');
  try {
    await unlink(TOKEN_PATH);
    return true;
  } catch {
    return false;
  }
}

export async function tokenStatus() {
  const cached = await readCache();
  if (!cached?.access_token) return { valid: false, reason: 'no cached token' };
  const remaining = cached.expires_at - Date.now();
  if (remaining <= 0) return { valid: false, reason: 'expired', expires_at: cached.expires_at };
  return { valid: true, expires_at: cached.expires_at, remaining_ms: remaining };
}
