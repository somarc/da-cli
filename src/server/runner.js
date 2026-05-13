import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { load as parseYaml } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const BIN = join(dirname(__filename), '../../bin/da.js');

// Build root CLI flags from HTTP request body fields.
// Always adds --commit (callers have explicitly requested the operation + paid)
// and --format json for machine-parseable output.
export function buildFlags(body) {
  const flags = ['--commit', '--format', 'json'];
  if (body.org)  flags.push('--org',  body.org);
  if (body.repo) flags.push('--repo', body.repo);
  if (body.env)  flags.push('--env',  body.env);
  return flags;
}

// Returns true if any pipeline step has requires_approval: true.
// stdin is detached in the HTTP runner, so interactive approval gates cannot
// complete — callers must reject such pipelines before spawning.
export function hasApprovalGates(yamlContent) {
  try {
    const doc = parseYaml(yamlContent);
    const steps = (doc?.pipeline ?? doc)?.steps ?? [];
    return steps.some((s) => s?.requires_approval === true);
  } catch {
    return false;
  }
}

// Spawn the da CLI binary with the given subcommand args + flags.
// Resolves with { ok, code, data, stderr } — data is parsed JSON when possible.
export function runDaCommand(subcommand, flags = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [BIN, ...subcommand, ...flags], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('exit', (code) => {
      let data = stdout.trim() || null;
      try { if (data) data = JSON.parse(data); } catch { /* keep raw string */ }
      resolve({ ok: code === 0, code, data, stderr: stderr.trim() || undefined });
    });
    proc.on('error', reject);
  });
}

// Write content to a temp file, call fn(tmpPath), then clean up.
export async function withTempFile(content, ext, fn) {
  const tmpPath = join(tmpdir(), `da-${randomUUID()}${ext}`);
  try {
    await writeFile(tmpPath, content, 'utf8');
    return await fn(tmpPath);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

// Resolve a named pipeline to its YAML file path in ~/.da/pipelines/.
// Returns null if not found.
export async function resolvePipelineName(name) {
  const safe = name.replace(/[/\\]/g, '-');
  for (const ext of ['.yaml', '.yml']) {
    const candidate = join(homedir(), '.da', 'pipelines', `${safe}${ext}`);
    try { await access(candidate); return candidate; } catch { /* try next */ }
  }
  return null;
}
