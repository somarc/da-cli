import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { print, info } from '../lib/output.js';
import { resolveConfig } from '../lib/config.js';

const QUERY_FILE = 'helix-query.yaml';

export function makeIndexCommand() {
  const index = new Command('index').description('Inspect and query helix-query.yaml indices');

  // ─── show ──────────────────────────────────────────────────────────────────
  index
    .command('show')
    .description('Print index definitions from helix-query.yaml with field list')
    .option('--file <path>', 'Path to helix-query.yaml (default: search upward from cwd)')
    .action(async (opts) => {
      const { yaml, filePath } = await loadQueryYaml(opts.file);
      info(`Source: ${filePath}`);

      const indices = yaml.indices ?? {};
      const rows = Object.entries(indices).map(([name, def]) => ({
        index: name,
        target: def.target ?? '',
        fields: Object.keys(def.properties ?? {}).join(', '),
        include: (def.include ?? []).join(', ') || '(all)',
      }));
      print(rows);
    });

  // ─── validate ──────────────────────────────────────────────────────────────
  index
    .command('validate')
    .description('Check helix-query.yaml fields against live query-index responses')
    .option('--file <path>', 'Path to helix-query.yaml')
    .option('--env <env>', 'preview or live (default: live)')
    .action(async (opts) => {
      const { yaml, filePath } = await loadQueryYaml(opts.file);
      const { org, repo, config } = await resolveConfig();
      const branch = config.branch ?? 'main';
      const domain = opts.env === 'preview' ? 'aem.page' : 'aem.live';
      const base = `https://${branch}--${repo}--${org}.${domain}`;

      info(`Source: ${filePath}`);
      info(`Validating against: ${base}`);

      const indices = yaml.indices ?? {};
      const results = [];

      for (const [name, def] of Object.entries(indices)) {
        const target = def.target ?? '/query-index';
        const url = `${base}${target}.json?limit=1`;
        let status = 'ok';
        let missing = [];
        let note = '';

        try {
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36' },
          });
          if (!res.ok) {
            status = `HTTP ${res.status}`;
          } else {
            const data = await res.json();
            const liveColumns = data.columns ?? Object.keys(data.data?.[0] ?? {});
            const defined = Object.keys(def.properties ?? {});
            missing = defined.filter((f) => !liveColumns.includes(f));
            if (missing.length) status = 'fields-missing';
            note = `live columns: ${liveColumns.join(', ')}`;
          }
        } catch (err) {
          status = `error: ${err.message}`;
        }

        results.push({
          index: name,
          target,
          status,
          missing: missing.join(', ') || '',
          note,
        });
      }

      print(results);
      if (results.some((r) => r.status !== 'ok')) process.exit(1);
    });

  // ─── query ─────────────────────────────────────────────────────────────────
  index
    .command('query <idx>')
    .description('Run a live query against an index and return results')
    .option('--filter <kv>', 'Client-side filter as key=value (repeatable)', collect, [])
    .option('--limit <n>', 'Max records to fetch', '50')
    .option('--offset <n>', 'Starting offset', '0')
    .option('--env <env>', 'preview or live (default: live)')
    .option('--file <path>', 'Path to helix-query.yaml')
    .action(async (idx, opts) => {
      const { yaml } = await loadQueryYaml(opts.file);
      const { org, repo, config } = await resolveConfig();
      const branch = config.branch ?? 'main';
      const domain = opts.env === 'preview' ? 'aem.page' : 'aem.live';
      const base = `https://${branch}--${repo}--${org}.${domain}`;

      const def = (yaml.indices ?? {})[idx];
      if (!def) {
        const available = Object.keys(yaml.indices ?? {}).join(', ');
        console.error(`Index "${idx}" not found. Available: ${available || '(none)'}`);
        process.exit(1);
      }

      const target = def.target ?? '/query-index';
      const url = `${base}${target}.json?limit=${opts.limit}&offset=${opts.offset}`;
      info(`GET ${url}`);

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36' },
      });
      if (!res.ok) {
        console.error(`HTTP ${res.status} from ${url}`);
        process.exit(1);
      }

      const data = await res.json();
      let rows = data.data ?? [];

      // Client-side filtering: --filter key=value
      for (const kv of opts.filter) {
        const eq = kv.indexOf('=');
        if (eq < 0) continue;
        const key = kv.slice(0, eq);
        const val = kv.slice(eq + 1).toLowerCase();
        rows = rows.filter((r) => String(r[key] ?? '').toLowerCase().includes(val));
      }

      info(`${rows.length} result(s) (total: ${data.total}, offset: ${data.offset})`);
      print(rows);
    });

  return index;
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function loadQueryYaml(override) {
  const filePath = override ?? findQueryYaml();
  if (!filePath) {
    console.error(`${QUERY_FILE} not found — run from an EDS project directory or pass --file`);
    process.exit(1);
  }
  try {
    const raw = await readFile(filePath, 'utf8');
    return { yaml: parseYaml(raw), filePath };
  } catch (err) {
    console.error(`Cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

function findQueryYaml(start = process.cwd()) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, QUERY_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function collect(val, acc) {
  acc.push(val);
  return acc;
}
