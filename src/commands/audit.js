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

// EDS blocks in .plain.html: <div class="block-name [variants]"> with <div> rows inside.
// System wrappers that are not authoring blocks:
const BLOCK_SKIP = new Set(['metadata', 'section-metadata']);

function extractBlockNames(html) {
  const re = /<div\s+class="([\w][\w-]*(?:\s+[\w][\w-]*)*)"\s*>/gi;
  const names = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const primary = m[1].trim().split(/\s+/)[0];
    if (!BLOCK_SKIP.has(primary)) names.add(primary);
  }
  return names;
}

function extractBlockDetails(html) {
  const re = /<div\s+class="([\w][\w-]*(?:\s+[\w][\w-]*)*)"\s*>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const primary = m[1].trim().split(/\s+/)[0];
    if (BLOCK_SKIP.has(primary)) continue;
    const innerStart = m.index + m[0].length;
    const inner = extractDivContent(html, innerStart);
    if (inner === null) continue;
    const rows = countDirectDivChildren(inner);
    const firstRowContent = extractFirstDirectDivContent(inner);
    const cols = firstRowContent !== null ? countDirectDivChildren(firstRowContent) : 0;
    blocks.push({ name: primary, rows, cols });
    // Advance past this block's closing tag so nested classed divs aren't extracted separately
    re.lastIndex = innerStart + inner.length + '</div>'.length;
  }
  return blocks;
}

// Walk from fromIndex (just after an opening <div>) to find its matching </div>.
// Returns the inner content (excluding the outer tags), or null if malformed.
function extractDivContent(html, fromIndex) {
  let depth = 1;
  let i = fromIndex;
  while (i < html.length && depth > 0) {
    const nextOpen = findNextDiv(html, i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return html.slice(fromIndex, nextClose);
      i = nextClose + 6;
    }
  }
  return null;
}

// Count the number of direct-child <div> elements within html (depth 0 only).
function countDirectDivChildren(html) {
  if (!html) return 0;
  let count = 0;
  let depth = 0;
  let i = 0;
  while (i < html.length) {
    const nextOpen = findNextDiv(html, i);
    const nextClose = html.indexOf('</div>', i);
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      if (depth === 0) count++;
      depth++;
      i = nextOpen + 4;
    } else if (nextClose !== -1) {
      depth--;
      i = nextClose + 6;
    } else {
      break;
    }
  }
  return count;
}

// Return the inner content of the first direct-child <div>, or null if none.
function extractFirstDirectDivContent(html) {
  if (!html) return null;
  let depth = 0;
  let i = 0;
  let firstInnerStart = -1;
  while (i < html.length) {
    const nextOpen = findNextDiv(html, i);
    const nextClose = html.indexOf('</div>', i);
    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      if (depth === 0) firstInnerStart = html.indexOf('>', nextOpen) + 1;
      depth++;
      i = nextOpen + 4;
    } else if (nextClose !== -1) {
      depth--;
      if (depth === 0 && firstInnerStart !== -1) return html.slice(firstInnerStart, nextClose);
      i = nextClose + 6;
    } else {
      break;
    }
  }
  return null;
}

// Find the next <div> or <div ...> opening tag at or after fromIndex.
// Avoids matching <divider> or other elements that start with "div".
function findNextDiv(html, fromIndex) {
  let i = fromIndex;
  while (i < html.length) {
    const pos = html.indexOf('<div', i);
    if (pos === -1) return -1;
    const ch = html[pos + 4];
    if (ch === '>' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') return pos;
    i = pos + 4;
  }
  return -1;
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
