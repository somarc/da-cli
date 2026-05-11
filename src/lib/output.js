import { getGlobals } from './context.js';

// Resolves output format: explicit --format flag wins; otherwise auto-detect
// from TTY state (piped stdout → JSON for machine consumption).
export function resolveFormat() {
  const { format } = getGlobals();
  if (format) return format;
  return process.stdout.isTTY ? 'table' : 'json';
}

export function print(data) {
  const fmt = resolveFormat();
  if (fmt === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else if (fmt === 'md') {
    printMd(data);
  } else {
    printTable(data);
  }
}

function printTable(data) {
  if (Array.isArray(data)) {
    if (data.length === 0) { console.log('(empty)'); return; }
    const keys = Object.keys(data[0]);
    const widths = keys.map((k) =>
      Math.max(k.length, ...data.map((r) => String(r[k] ?? '').length))
    );
    const row = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
    console.log(row(keys));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of data) console.log(row(keys.map((k) => r[k])));
  } else if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data)) {
      console.log(`${String(k).padEnd(20)}  ${v}`);
    }
  } else {
    console.log(data);
  }
}

function printMd(data) {
  if (Array.isArray(data)) {
    if (data.length === 0) { console.log('(empty)'); return; }
    const keys = Object.keys(data[0]);
    console.log(`| ${keys.join(' | ')} |`);
    console.log(`| ${keys.map(() => '---').join(' | ')} |`);
    for (const r of data) {
      console.log(`| ${keys.map((k) => String(r[k] ?? '')).join(' | ')} |`);
    }
  } else {
    printTable(data);
  }
}

export function info(msg) {
  if (!getGlobals().quiet) console.error(msg);
}

export function verbose(msg) {
  if (getGlobals().verbose) console.error(`[verbose] ${msg}`);
}
