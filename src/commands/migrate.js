import { Command } from 'commander';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createClient } from '../lib/da-client.js';
import { guardWrite, simpleDiff } from '../lib/mutation.js';
import { print, info } from '../lib/output.js';
import { auditHeadings, auditMetadata, auditLinks, auditBlocks } from '../lib/audit-engines.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const JOB_DIR = join(homedir(), '.da', 'migrate-jobs');

export function makeMigrateCommand() {
  const migrate = new Command('migrate').description('Import external web pages into DA as EDS content');

  // ─── import ────────────────────────────────────────────────────────────────
  migrate
    .command('import <url>')
    .description('Scrape a URL, convert to EDS HTML, upload to DA, and preview')
    .option('--path <daPath>', 'DA path to write to (default: derived from URL pathname)')
    .option('--no-preview', 'Skip preview trigger after upload')
    .action(async (url, opts) => {
      const client = await createClient();
      info(`Scraping ${url}…`);
      const { edsHtml, metadata } = await scrapeAndConvert(url);
      const daPath = opts.path ?? urlToPath(url);

      info(`Target: ${daPath}`);
      info(`Title: ${metadata.title ?? '(none)'}`);

      let existing = '';
      try {
        const res = await client.sourceGet(daPath);
        existing = await res.text();
      } catch { /* new file */ }

      const diff = simpleDiff(existing, edsHtml);
      if (!guardWrite(`Upload ${daPath}`).proceed) {
        info('\n--- Generated EDS HTML (first 3000 chars) ---');
        info(edsHtml.slice(0, 3000) + (edsHtml.length > 3000 ? '\n…(truncated)' : ''));
        info('\n--- Diff ---');
        info(diff);
        return;
      }

      await client.sourcePut(daPath, edsHtml);
      info(`Uploaded: ${daPath}`);

      if (opts.preview !== false) {
        info('Triggering preview…');
        try {
          const result = await client.helixPreview(daPath);
          const previewUrl = result?.preview?.url ?? result?.url;
          if (previewUrl) info(`Preview: ${previewUrl}`);
        } catch (err) {
          info(`Preview failed (non-fatal): ${err.message}`);
        }
      }

      print([{ path: daPath, title: metadata.title ?? '', status: 'imported' }]);
    });

  // ─── batch ─────────────────────────────────────────────────────────────────
  migrate
    .command('batch <url-file>')
    .description('Import multiple URLs from a newline-delimited file in parallel')
    .option('--path-prefix <prefix>', 'DA path prefix prepended to each derived path', '')
    .option('--concurrency <n>', 'Max parallel imports', '3')
    .option('--job-id <id>', 'Resume an existing job (omit to start a new one)')
    .action(async (urlFile, opts) => {
      const client = await createClient();
      const urls = await readUrlFile(urlFile);
      if (urls.length === 0) { info('No URLs found in file.'); return; }

      const jobId = opts.jobId ?? randomUUID().slice(0, 8);
      await mkdir(JOB_DIR, { recursive: true });
      const jobPath = join(JOB_DIR, `${jobId}.json`);

      let jobState = {};
      try { jobState = JSON.parse(await readFile(jobPath, 'utf8')); } catch { /* fresh */ }

      const pending = urls.filter((u) => jobState[u]?.status !== 'done');
      info(`Job ${jobId}: ${urls.length} URL(s), ${pending.length} pending`);

      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 3);
      let done = 0;

      await runConcurrent(
        pending.map((url) => async () => {
          const daPath = opts.pathPrefix + urlToPath(url);
          try {
            const { edsHtml, metadata } = await scrapeAndConvert(url);
            if (guardWrite(`Upload ${daPath}`).proceed) {
              await client.sourcePut(daPath, edsHtml);
              try { await client.helixPreview(daPath); } catch { /* non-fatal */ }
              jobState[url] = { status: 'done', path: daPath, title: metadata.title ?? '' };
            } else {
              jobState[url] = { status: 'dry-run', path: daPath };
            }
          } catch (err) {
            jobState[url] = { status: 'error', path: daPath, error: err.message };
          }
          done++;
          info(`[${done}/${pending.length}] ${url}`);
          await writeFile(jobPath, JSON.stringify(jobState, null, 2));
        }),
        concurrency,
      );

      info(`Job ${jobId} complete. State: ${jobPath}`);
      print(Object.entries(jobState).map(([url, s]) => ({ url, ...s })));
    });

  // ─── status ────────────────────────────────────────────────────────────────
  migrate
    .command('status [job-id]')
    .description('Show batch import job progress')
    .action(async (jobId) => {
      if (!jobId) {
        let entries = [];
        try { entries = (await readdir(JOB_DIR)).filter((f) => f.endsWith('.json')); }
        catch { info('No batch jobs found.'); return; }
        if (entries.length === 0) { info('No batch jobs found.'); return; }
        const rows = [];
        for (const f of entries) {
          try {
            const state = JSON.parse(await readFile(join(JOB_DIR, f), 'utf8'));
            const vals = Object.values(state);
            rows.push({
              jobId: f.replace('.json', ''),
              total: vals.length,
              done: vals.filter((s) => s.status === 'done').length,
              'dry-run': vals.filter((s) => s.status === 'dry-run').length,
              error: vals.filter((s) => s.status === 'error').length,
            });
          } catch { /* skip corrupt files */ }
        }
        print(rows);
        return;
      }

      const jobPath = join(JOB_DIR, `${jobId}.json`);
      let state;
      try { state = JSON.parse(await readFile(jobPath, 'utf8')); }
      catch { console.error(`Job ${jobId} not found.`); process.exit(1); }
      print(Object.entries(state).map(([url, s]) => ({ url, ...s })));
    });

  // ─── validate ──────────────────────────────────────────────────────────────
  migrate
    .command('validate <path>')
    .description('Validate an imported page via its EDS preview URL (.plain.html audit)')
    .action(async (path) => {
      const { resolveConfig } = await import('../lib/config.js');
      const { org, repo, config } = await resolveConfig();
      const branch = config.branch ?? 'main';
      const base = `https://${branch}--${repo}--${org}.aem.page`;
      const stem = (path.startsWith('/') ? '' : '/') + path.replace(/\.html$/, '');
      const headPath = stem.replace(/\/index$/, '/') || '/';

      info(`Validating: ${base}${stem}`);
      const [plainRes, headRes] = await Promise.all([
        fetch(`${base}${stem}.plain.html`, { headers: { 'User-Agent': UA } }),
        fetch(`${base}${headPath}`, { headers: { 'User-Agent': UA } }),
      ]);

      if (!plainRes.ok) {
        console.error(`HTTP ${plainRes.status} — page not yet previewed, or path is wrong`);
        process.exit(1);
      }

      const plain = await plainRes.text();
      const head = headRes.ok ? await headRes.text() : '';
      const findings = [
        ...auditHeadings(plain),
        ...auditMetadata(head),
        ...auditLinks(plain),
        ...auditBlocks(plain),
      ];

      info(`Audit: ${path}`);
      print(findings);
      const errors = findings.filter((f) => f.severity === 'error').length;
      const warnings = findings.filter((f) => f.severity === 'warning').length;
      info(`${errors} error(s), ${warnings} warning(s)`);
      if (errors > 0) process.exit(1);
    });

  return migrate;
}

// ── scrape + convert pipeline ─────────────────────────────────────────────────

async function scrapeAndConvert(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const raw = await res.text();

  const metadata = extractPageMetadata(raw, url);
  const main = extractMainContent(raw);
  const withAbsUrls = absolutizeUrls(main, url);
  const cleaned = cleanHtml(withAbsUrls);
  const withBlocks = convertBlocks(cleaned);
  const edsHtml = buildEdsDocument(withBlocks, metadata);

  return { edsHtml, metadata };
}

// Find the outermost <main>, <article>, or <body> content.
function extractMainContent(html) {
  for (const tag of ['main', 'article']) {
    const content = extractTagContent(html, tag);
    if (content && content.trim().length > 200) return content;
  }
  // Fallback: body content minus nav/header/footer
  const body = extractTagContent(html, 'body') ?? html;
  return body
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
}

// Depth-tracking extractor for a single HTML tag (handles nesting).
function extractTagContent(html, tag) {
  const lower = html.toLowerCase();
  const open = `<${tag}`;
  const close = `</${tag}>`;

  let start = -1;
  let i = 0;
  while (i < lower.length) {
    const pos = lower.indexOf(open, i);
    if (pos === -1) return null;
    const ch = lower[pos + open.length];
    if (ch === '>' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      start = pos;
      break;
    }
    i = pos + open.length;
  }
  if (start === -1) return null;

  const contentStart = lower.indexOf('>', start) + 1;
  let depth = 1;
  let pos = contentStart;
  while (pos < lower.length && depth > 0) {
    const nextOpen = findTagOpen(lower, open, pos);
    const nextClose = lower.indexOf(close, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + open.length;
    } else {
      depth--;
      if (depth === 0) return html.slice(contentStart, nextClose);
      pos = nextClose + close.length;
    }
  }
  return null;
}

function findTagOpen(lower, open, fromIndex) {
  let i = fromIndex;
  while (i < lower.length) {
    const pos = lower.indexOf(open, i);
    if (pos === -1) return -1;
    const ch = lower[pos + open.length];
    if (ch === '>' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') return pos;
    i = pos + open.length;
  }
  return -1;
}

// Extract og/meta tags from <head>.
function extractPageMetadata(html, sourceUrl) {
  const get = (re) => re.exec(html)?.[1]?.trim() ?? null;
  return {
    title: get(/property="og:title"\s+content="([^"]+)"/i)
        ?? get(/content="([^"]+)"\s+property="og:title"/i)
        ?? get(/<title[^>]*>([^<]+)<\/title>/i),
    description: get(/name="description"\s+content="([^"]+)"/i)
              ?? get(/content="([^"]+)"\s+name="description"/i)
              ?? get(/property="og:description"\s+content="([^"]+)"/i)
              ?? get(/content="([^"]+)"\s+property="og:description"/i),
    image: get(/property="og:image"\s+content="([^"]+)"/i)
        ?? get(/content="([^"]+)"\s+property="og:image"/i),
    canonical: get(/rel="canonical"\s+href="([^"]+)"/i)
            ?? get(/href="([^"]+)"\s+rel="canonical"/i)
            ?? sourceUrl,
  };
}

// Make relative URLs absolute using the source page's URL as base.
function absolutizeUrls(html, baseUrl) {
  const base = new URL(baseUrl);
  return html
    .replace(/(\ssrc=")([^"]+)(")/gi, (_, pre, url, post) => {
      try { return `${pre}${new URL(url, base).href}${post}`; } catch { return `${pre}${url}${post}`; }
    })
    .replace(/(\shref=")([^"]+)(")/gi, (_, pre, url, post) => {
      if (/^(#|mailto:|tel:)/i.test(url)) return `${pre}${url}${post}`;
      try { return `${pre}${new URL(url, base).href}${post}`; } catch { return `${pre}${url}${post}`; }
    });
}

// Strip scripts, styles, comments, classes, inline styles, and noise elements.
function cleanHtml(html) {
  return html
    // Remove block-level noise elements entirely
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // Remove noisy structural elements by common patterns
    .replace(/<(aside|form|dialog)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Strip all attributes except content-essential ones, per-tag in a single pass
    .replace(/<([a-z][a-z0-9]*)\s([^>]+)>/gi, (_, tag, attrs) => {
      const t = tag.toLowerCase();
      if (t === 'a') {
        const href = /href="([^"]*)"/.exec(attrs)?.[0] ?? '';
        return href ? `<${tag} ${href}>` : `<${tag}>`;
      }
      if (t === 'img') {
        const src = /src="([^"]*)"/.exec(attrs)?.[0] ?? '';
        const alt = /alt="([^"]*)"/.exec(attrs)?.[0] ?? '';
        const parts = [src, alt].filter(Boolean).join(' ');
        return parts ? `<${tag} ${parts}>` : `<${tag}>`;
      }
      if (t === 'iframe') {
        const src = /src="([^"]*)"/.exec(attrs)?.[0] ?? '';
        return src ? `<${tag} ${src}>` : `<${tag}>`;
      }
      return `<${tag}>`;
    })
    // Collapse iframe content (already single-tag after attribute strip above)
    .replace(/<iframe([^>]*)>[\s\S]*?<\/iframe>/gi, '<iframe$1></iframe>')
    // Collapse excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
}

// Convert recognizable HTML patterns into EDS block table markup.
function convertBlocks(html) {
  // Iframes → embed block
  html = html.replace(
    /<iframe src="([^"]+)"><\/iframe>/gi,
    (_, src) => `<div class="embed"><div><div><a href="${src}">${src}</a></div></div></div>`,
  );

  // <figure> with <img>: first one becomes hero, rest stay as image + caption
  let firstFigure = true;
  html = html.replace(/<figure>([\s\S]*?)<\/figure>/gi, (_, content) => {
    const imgMatch = /<img[^>]+>/i.exec(content);
    if (!imgMatch) return content.replace(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi, '<p>$1</p>');
    const img = imgMatch[0];
    const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(content);
    const caption = captionMatch?.[1]?.trim() ?? '';
    if (firstFigure && caption) {
      firstFigure = false;
      return `<div class="hero"><div><div>${img}</div></div><div><div><p>${caption}</p></div></div></div>`;
    }
    firstFigure = false;
    return caption ? `${img}\n<p>${caption}</p>` : img;
  });

  return html;
}

// Assemble the full EDS HTML document with skeleton and metadata block.
function buildEdsDocument(content, metadata) {
  const rows = [];
  if (metadata.title) rows.push(`<div><div>title</div><div>${esc(metadata.title)}</div></div>`);
  if (metadata.description) rows.push(`<div><div>description</div><div>${esc(metadata.description)}</div></div>`);
  if (metadata.image) rows.push(`<div><div>image</div><div><img src="${esc(metadata.image)}"></div></div>`);
  if (metadata.canonical) rows.push(`<div><div>canonical</div><div>${esc(metadata.canonical)}</div></div>`);

  const metaBlock = rows.length > 0
    ? `\n<div class="metadata">\n${rows.join('\n')}\n</div>`
    : '';

  return `<body>\n<header></header>\n<main>\n<div>\n${content.trim()}${metaBlock}\n</div>\n</main>\n<footer></footer>\n</body>`;
}

// Derive a DA path from a URL (strips domain, normalises extension).
// https://old.com/ → /index.html   https://old.com/page → /page.html
export function urlToPath(url) {
  try {
    const { pathname } = new URL(url);
    const p = pathname.replace(/\/$/, '') || '/index';
    return p.endsWith('.html') ? p : `${p}.html`;
  } catch {
    return '/imported.html';
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function readUrlFile(filePath) {
  const text = await readFile(filePath, 'utf8').catch(() => { throw new Error(`Cannot read ${filePath}`); });
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ── test exports ──────────────────────────────────────────────────────────────
export { scrapeAndConvert, extractPageMetadata, absolutizeUrls, cleanHtml, convertBlocks, buildEdsDocument, extractTagContent };
