import { Command } from 'commander';
import { resolveConfig } from '../lib/config.js';
import { print, info } from '../lib/output.js';

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

      // List source files
      const { createClient } = await import('../lib/da-client.js');
      const client = await createClient();
      const data = await client.list(opts.prefix.replace(/\/$/, ''));
      const items = Array.isArray(data) ? data : (data?.sources ?? []);
      const paths = items.filter((s) => s.ext === 'html').map((s) =>
        s.path.replace(`/${client.org}/${client.repo}`, ''),
      );

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

// ── audit engines ────────────────────────────────────────────────────────────

function auditHeadings(html) {
  const findings = [];
  const headings = extractHeadings(html);

  const h1s = headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    findings.push({ severity: 'error', check: 'headings', detail: 'No h1 found' });
  } else if (h1s.length > 1) {
    findings.push({ severity: 'error', check: 'headings', detail: `Multiple h1s (${h1s.length})` });
  }

  // Detect level jumps: e.g. h1 → h3 skipping h2
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1].level;
    const curr = headings[i].level;
    if (curr > prev + 1) {
      findings.push({
        severity: 'warning',
        check: 'headings',
        detail: `Heading jump h${prev}→h${curr}: "${headings[i].text.slice(0, 60)}"`,
      });
    }
  }

  if (findings.length === 0) {
    findings.push({ severity: 'pass', check: 'headings', detail: `${headings.length} heading(s), hierarchy ok` });
  }
  return findings;
}

function auditMetadata(headHtml) {
  // EDS compiles the metadata block into <head> og/meta tags; check those instead of .plain.html
  const findings = [];
  const ogTitle = /property="og:title"\s+content="([^"]+)"/i.exec(headHtml)?.[1]
    ?? /content="([^"]+)"\s+property="og:title"/i.exec(headHtml)?.[1];
  const ogDesc = /name="description"\s+content="([^"]+)"/i.exec(headHtml)?.[1]
    ?? /content="([^"]+)"\s+name="description"/i.exec(headHtml)?.[1];

  if (!ogTitle) findings.push({ severity: 'warning', check: 'metadata', detail: 'Missing og:title' });
  if (!ogDesc) findings.push({ severity: 'warning', check: 'metadata', detail: 'Missing meta description' });
  if (!findings.length) {
    findings.push({ severity: 'pass', check: 'metadata', detail: `title: "${ogTitle?.slice(0, 50)}"` });
  }
  return findings;
}

function auditLinks(html) {
  const findings = [];
  const links = extractLinks(html);

  const empty = links.filter((l) => !l || l === '#');
  if (empty.length) {
    findings.push({ severity: 'warning', check: 'links', detail: `${empty.length} empty/# href(s)` });
  }

  const external = links.filter((l) => l.startsWith('http'));
  const internal = links.filter((l) => l.startsWith('/'));
  const other = links.filter((l) => l && !l.startsWith('http') && !l.startsWith('/') && l !== '#');

  if (other.length) {
    findings.push({ severity: 'warning', check: 'links', detail: `${other.length} non-absolute, non-root-relative link(s): ${other.slice(0, 3).join(', ')}` });
  }

  if (!findings.length) {
    findings.push({ severity: 'pass', check: 'links', detail: `${links.length} link(s): ${internal.length} internal, ${external.length} external` });
  }
  return findings;
}

function auditBlocks(html) {
  const findings = [];
  const blocks = extractBlockDetails(html);

  if (blocks.length === 0) {
    findings.push({ severity: 'pass', check: 'blocks', detail: 'No blocks found (content-only page)' });
    return findings;
  }

  for (const block of blocks) {
    if (block.rows === 0) {
      findings.push({ severity: 'warning', check: 'blocks', detail: `Block "${block.name}" has no rows` });
    } else {
      findings.push({ severity: 'pass', check: 'blocks', detail: `Block "${block.name}": ${block.rows} row(s), ${block.cols} col(s)` });
    }
  }
  return findings;
}

// ── HTML extractors ───────────────────────────────────────────────────────────

function extractHeadings(html) {
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    headings.push({ level: parseInt(m[1]), text: m[2].replace(/<[^>]+>/g, '').trim() });
  }
  return headings;
}

function extractMetadata(html) {
  const metaRe = /<div class="metadata">([\s\S]*?)<\/div>\s*\n?\s*<\/div>/i;
  const metaMatch = metaRe.exec(html);
  if (!metaMatch) return null;
  const rows = {};
  const rowRe = /<div>\s*<div>([^<]+)<\/div>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let m;
  while ((m = rowRe.exec(metaMatch[1])) !== null) {
    rows[m[1].trim().toLowerCase()] = m[2].replace(/<[^>]+>/g, '').trim();
  }
  return rows;
}

function extractLinks(html) {
  const re = /<a[^>]+href="([^"]*)"[^>]*>/gi;
  const links = [];
  let m;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return links;
}

function extractBlockNames(html) {
  const re = /<div class="([\w-]+(?:\s+[\w-]+)*)">/gi;
  const names = new Set();
  const skip = new Set(['metadata', 'section-metadata']);
  let m;
  while ((m = re.exec(html)) !== null) {
    const primary = m[1].trim().split(/\s+/)[0];
    if (!skip.has(primary)) names.add(primary);
  }
  return names;
}

function extractBlockDetails(html) {
  const re = /<div class="([\w-]+(?:\s+[\w-]+)*)">([\s\S]*?)<\/div>\s*(?=<div|$)/gi;
  const skip = new Set(['metadata', 'section-metadata', 'columns', 'cards', 'hero']);
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim().split(/\s+/)[0];
    if (skip.has(name)) continue;
    const inner = m[2];
    const rows = (inner.match(/<div>/g) ?? []).length;
    const firstRow = /<div>([\s\S]*?)<\/div>/.exec(inner);
    const cols = firstRow ? (firstRow[1].match(/<div>/g) ?? []).length : 0;
    blocks.push({ name, rows, cols });
  }
  return blocks;
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
