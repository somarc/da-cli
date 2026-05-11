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
