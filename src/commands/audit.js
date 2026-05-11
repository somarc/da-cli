import { Command } from 'commander';
import { resolveConfig } from '../lib/config.js';
import { print, info } from '../lib/output.js';
import {
  auditHeadings, auditMetadata, auditLinks, auditBlocks,
  extractBlockDetails, extractBlockNames,
} from '../lib/audit-engines.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function makeAuditCommand() {
  const audit = new Command('audit').description('Validate EDS page content via .plain.html');

  // ─── semantics ─────────────────────────────────────────────────────────────
  audit
    .command('semantics <path>')
    .description('Check heading hierarchy, metadata quality, and link quality')
    .action(async (path) => {
      const { plain, head } = await fetchBoth(path);
      const findings = [
        ...auditHeadings(plain),
        ...auditMetadata(head),
        ...auditLinks(plain),
      ];
      printFindings(findings, path);
    });

  // ─── blocks ────────────────────────────────────────────────────────────────
  audit
    .command('blocks <path>')
    .description('Validate block structure and decoration from .plain.html')
    .action(async (path) => {
      const { plain } = await fetchBoth(path);
      const findings = auditBlocks(plain);
      printFindings(findings, path);
    });

  // ─── full ──────────────────────────────────────────────────────────────────
  audit
    .command('full <path>')
    .description('Run all audits — unified report with severity classification')
    .action(async (path) => {
      const { plain, head } = await fetchBoth(path);
      const findings = [
        ...auditHeadings(plain),
        ...auditMetadata(head),
        ...auditLinks(plain),
        ...auditBlocks(plain),
      ];
      printFindings(findings, path);
      if (findings.some((f) => f.severity === 'error')) process.exit(1);
    });

  // ─── contracts ─────────────────────────────────────────────────────────────
  audit
    .command('contracts')
    .description('List all block class names used across a path prefix')
    .option('--prefix <prefix>', 'DA path prefix to scan', '/')
    .action(async (opts) => {
      const { org, repo, config } = await resolveConfig();
      const branch = config.branch ?? 'main';
      const base = `https://${branch}--${repo}--${org}.aem.page`;

      const { createClient } = await import('../lib/da-client.js');
      const client = await createClient();
      const paths = await listAllHtmlPaths(client, opts.prefix);

      info(`Scanning ${paths.length} pages for block contracts…`);
      const blockMap = {};

      await Promise.all(paths.map(async (p) => {
        try {
          const res = await fetch(`${base}${p.replace(/\.html$/, '')}.plain.html`, { headers: { 'User-Agent': UA } });
          if (!res.ok) return;
          const html = await res.text();
          for (const name of extractBlockNames(html)) {
            blockMap[name] = (blockMap[name] ?? 0) + 1;
          }
        } catch { /* best-effort */ }
      }));

      const rows = Object.entries(blockMap)
        .sort((a, b) => b[1] - a[1])
        .map(([block, count]) => ({ block, pages: count }));

      print(rows);
    });

  return audit;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function listAllHtmlPaths(client, prefix) {
  const results = [];
  const queue = [prefix.replace(/\/$/, '') || '/'];
  while (queue.length) {
    const current = queue.shift();
    const data = await client.list(current);
    const items = Array.isArray(data) ? data : (data?.sources ?? []);
    for (const item of items) {
      const rel = item.path.replace(`/${client.org}/${client.repo}`, '');
      if (item.ext === 'html') results.push(rel);
      else if (!item.ext) queue.push(rel);
    }
  }
  return results;
}

// ── output ────────────────────────────────────────────────────────────────────

function printFindings(findings, path) {
  info(`Audit: ${path}`);
  print(findings);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  info(`${errors} error(s), ${warnings} warning(s)`);
}

// ── network ───────────────────────────────────────────────────────────────────

async function fetchBoth(path) {
  const { resolveConfig } = await import('../lib/config.js');
  const { org, repo, config } = await resolveConfig();
  const branch = config.branch ?? 'main';
  const base = `https://${branch}--${repo}--${org}.aem.page`;
  const stem = (path.startsWith('/') ? '' : '/') + path.replace(/\.html$/, '');
  // .plain.html uses the stem as-is; full page fetch uses EDS root normalization (/index → /)
  const pagePath = stem;
  const headPath = stem.replace(/\/index$/, '/') || '/';

  const [plainRes, headRes] = await Promise.all([
    fetch(`${base}${pagePath}.plain.html`, { headers: { 'User-Agent': UA } }),
    fetch(`${base}${headPath}`, { headers: { 'User-Agent': UA } }),
  ]);

  if (!plainRes.ok) { console.error(`HTTP ${plainRes.status} from ${base}${pagePath}.plain.html`); process.exit(1); }
  const plain = await plainRes.text();
  const head = headRes.ok ? await headRes.text() : '';
  info(`Fetched ${base}${pagePath}`);
  return { plain, head };
}

// ── test exports (not part of the public CLI surface) ─────────────────────────
export { extractBlockDetails, extractBlockNames, listAllHtmlPaths };
