import { getGlobals } from './context.js';
import { info } from './output.js';

// All writes are dry-run by default. Pass --commit to execute.
// Returns { proceed: boolean, mode: 'dry-run' | 'commit' }.
//
// Usage:
//   const { proceed } = guardWrite('Upload /path/to/doc.html');
//   if (!proceed) return;
//   await client.sourcePut(...);
export function guardWrite(description) {
  const { commit, dryRun } = getGlobals();
  if (commit && !dryRun) {
    return { proceed: true, mode: 'commit' };
  }
  info(`[dry-run] ${description}`);
  info('  Pass --commit to execute.');
  return { proceed: false, mode: 'dry-run' };
}

export function printWritePreflight({
  client,
  operation,
  paths = [],
  source,
  configSources = {},
  notes = [],
}) {
  const pathList = Array.isArray(paths) ? paths : [paths].filter(Boolean);
  info('Write preflight:');
  info(`  Target: ${client.org}/${client.repo}`);
  info(`  Branch: ${client.branch ?? 'main'}`);
  if (configSources.org || configSources.repo) {
    info(`  Config: org=${configSources.org ?? 'unknown'}, repo=${configSources.repo ?? 'unknown'}`);
  }
  info(`  Operation: ${operation}`);
  if (source) info(`  Source: ${source}`);
  if (pathList.length) {
    info(`  Paths: ${pathList.length}`);
    for (const path of summarizePaths(pathList)) info(`    ${path}`);
  }
  for (const note of notes.filter(Boolean)) info(`  Note: ${note}`);
}

export function enforceBulkWriteSafety({
  pathCount,
  yes = false,
  configSources = {},
  operation = 'write',
}) {
  const { commit, dryRun, org, repo } = getGlobals();
  if (!commit || dryRun || yes || pathCount <= 1) return { proceed: true };
  const explicitTarget = Boolean(org && repo);
  if (explicitTarget) return { proceed: true };

  const orgSource = configSources.org ?? 'unknown';
  const repoSource = configSources.repo ?? 'unknown';
  return {
    proceed: false,
    reason: `${operation} affects ${pathCount} paths, but target came from config (org=${orgSource}, repo=${repoSource}). Re-run with explicit --org and --repo, or pass --yes after reviewing the preflight.`,
  };
}

function summarizePaths(paths) {
  if (paths.length <= 10) return paths;
  return [
    ...paths.slice(0, 5),
    `... ${paths.length - 10} more ...`,
    ...paths.slice(-5),
  ];
}

// Diff two strings for write-preview output (no external deps).
export function simpleDiff(oldText, newText) {
  if (oldText === newText) return '(no changes)';
  const oldLines = (oldText ?? '').split('\n');
  const newLines = (newText ?? '').split('\n');
  const lines = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === undefined) lines.push(`+ ${n}`);
    else if (n === undefined) lines.push(`- ${o}`);
    else if (o !== n) { lines.push(`- ${o}`); lines.push(`+ ${n}`); }
  }

  return lines.join('\n');
}
