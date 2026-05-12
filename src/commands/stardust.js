import { Command } from 'commander';
import { print, info } from '../lib/output.js';

// Stardust redesign pipeline for EDS sites.
// Four phases: extract → direct → prototype → migrate
// State stored in .stardust/state.json relative to CWD.
// Design taste sourced from:
//   - adobe/skills/plugins/stardust (4-phase methodology)
//   - ai-ecoverse/snowflake (EDS template target)
//   - pbakaus/impeccable (anti-pattern detection + design laws)

export function makeStardustCommand() {
  const stardust = new Command('stardust')
    .description('4-phase EDS site redesign pipeline — extract → direct → prototype → migrate')
    .action(async () => {
      // No subcommand: show state report
      const state = await loadState();
      if (process.stdout.isTTY) {
        printStateReport(state);
      } else {
        print(state);
      }
    });

  // ─── extract ───────────────────────────────────────────────────────────────
  stardust
    .command('extract [url]')
    .description('Phase 1 — crawl existing site and extract brand/content into .stardust/current/')
    .option('--pages <n>', 'Max pages to crawl (default: 5)', '5')
    .option('--branch <branch>', 'Git branch for DA fetch (default: main)')
    .action(async (url, opts) => {
      const { mkdirp, writeJson, readJson } = await fsHelpers();
      await mkdirp('.stardust/current');

      const maxPages = parseInt(opts.pages, 10) || 5;
      const pages = [];

      if (url) {
        // Crawl from public URL
        info(`Crawling ${url} (max ${maxPages} pages)…`);
        const crawled = await crawlSite(url, maxPages);
        pages.push(...crawled);
      } else {
        // Fetch from DA API
        info(`Fetching pages from DA (max ${maxPages})…`);
        const { createClient } = await import('../lib/da-client.js');
        const client = await createClient(opts.branch ? { branch: opts.branch } : {});
        const listing = await client.list('/');
        const items = Array.isArray(listing) ? listing : (listing?.sources ?? []);
        const htmlItems = items.filter((i) => i.ext === 'html').slice(0, maxPages);
        for (const item of htmlItems) {
          const rel = item.path.replace(`/${client.org}/${client.repo}`, '') || '/index';
          try {
            const html = await client.fetchPlainHtml(rel);
            pages.push({ path: rel, html, source: 'da' });
            info(`  extracted: ${rel}`);
          } catch (err) {
            info(`  skipped ${rel}: ${err.message}`);
          }
        }
      }

      if (pages.length === 0) {
        console.error('No pages extracted. Provide a --url or configure org/repo.');
        process.exit(1);
      }

      // Write per-page files
      for (const page of pages) {
        const slug = page.path.replace(/\//g, '-').replace(/^-/, '') || 'index';
        const { writeFile } = await import('node:fs/promises');
        await writeFile(`.stardust/current/${slug}.html`, page.html, 'utf8');
      }

      // Extract brand surface from pages
      const brandSurface = extractBrandSurface(pages);
      await writeJson('.stardust/current/_brand-surface.json', brandSurface);

      // Generate PRODUCT.md and DESIGN.md stubs in impeccable format
      await writeFile('.stardust/current/PRODUCT.md',
        generateProductMd(brandSurface, pages), 'utf8');
      await writeFile('.stardust/current/DESIGN.md',
        generateDesignMd(brandSurface), 'utf8');

      // Update state
      const state = await loadState();
      state.phase = 'extracted';
      state.extractedAt = new Date().toISOString();
      state.pageCount = pages.length;
      state.pages = pages.map((p) => ({ path: p.path, status: 'extracted' }));
      await writeJson('.stardust/state.json', state);

      info(`\nExtracted ${pages.length} page(s) → .stardust/current/`);
      info('Next: da stardust direct "<redesign intent>"');

      async function writeFile(p, content) {
        const { writeFile: wf } = await import('node:fs/promises');
        await wf(p, content, 'utf8');
      }
    });

  // ─── direct ────────────────────────────────────────────────────────────────
  stardust
    .command('direct [phrase]')
    .description('Phase 2 — resolve design intent into PRODUCT.md + DESIGN.md + DESIGN.json + direction.md')
    .option('--palette <name>', 'Force a specific palette name from the stardust palette library')
    .option('--register <r>', 'brand | product (default: product)', 'product')
    .option('--tone <t>', 'serious | neutral | playful (default: neutral)', 'neutral')
    .option('--density <d>', 'airy | balanced | packed (default: balanced)', 'balanced')
    .action(async (phrase, opts) => {
      const { writeJson, readJson, mkdirp } = await fsHelpers();
      const state = await loadState();

      if (state.phase === 'fresh') {
        console.error('Run `da stardust extract` first to seed .stardust/current/.');
        process.exit(1);
      }

      const intent = phrase ?? await promptPhrase();
      info(`Resolving intent: "${intent}"`);

      // Resolve the 8 stardust redesign dimensions
      const dimensions = resolveDimensions(intent, opts);
      info(`  register: ${dimensions.register}`);
      info(`  tone:     ${dimensions.tone}`);
      info(`  density:  ${dimensions.density}`);
      info(`  expressive axis: ${dimensions.expressiveAxis}`);

      // Select palette
      const palette = opts.palette
        ? { name: opts.palette }
        : selectPalette(intent, dimensions);
      info(`  palette:  ${palette.name}`);

      // Write direction.md (reasoning trace)
      const { writeFile } = await import('node:fs/promises');
      await writeFile('.stardust/direction.md', formatDirectionMd(intent, dimensions, palette), 'utf8');

      // Generate target PRODUCT.md and DESIGN.md at project root
      await writeFile('PRODUCT.md', generateTargetProductMd(intent, dimensions), 'utf8');
      await writeFile('DESIGN.md', generateTargetDesignMd(dimensions, palette), 'utf8');
      await writeJson('DESIGN.json', { intent, dimensions, palette, generatedAt: new Date().toISOString() });

      // Update state
      state.phase = 'directed';
      state.intent = intent;
      state.dimensions = dimensions;
      state.palette = palette;
      state.directedAt = new Date().toISOString();
      state.pages = (state.pages ?? []).map((p) => ({ ...p, status: 'directed' }));
      await writeJson('.stardust/state.json', state);

      info('\nDirection written → PRODUCT.md, DESIGN.md, DESIGN.json, .stardust/direction.md');
      info('Next: da stardust prototype [page-path]');
    });

  // ─── prototype ─────────────────────────────────────────────────────────────
  stardust
    .command('prototype [page]')
    .description('Phase 3 — generate before/after HTML prototype viewer for a page')
    .option('--all', 'Generate prototypes for all extracted pages')
    .action(async (page, opts) => {
      const { mkdirp, writeJson, readJson } = await fsHelpers();
      const state = await loadState();

      if (state.phase === 'fresh' || state.phase === 'extracted') {
        console.error('Run `da stardust direct` first to set design direction.');
        process.exit(1);
      }

      await mkdirp('.stardust/prototypes');

      const pages = opts.all
        ? (state.pages ?? []).map((p) => p.path)
        : [page ?? (state.pages?.[0]?.path ?? '/index')];

      const { writeFile, readFile } = await import('node:fs/promises');

      let generated = 0;
      for (const pagePath of pages) {
        const slug = pagePath.replace(/\//g, '-').replace(/^-/, '') || 'index';
        const beforeFile = `.stardust/current/${slug}.html`;
        let beforeHtml = '';
        try {
          beforeHtml = await readFile(beforeFile, 'utf8');
        } catch {
          info(`  no extracted HTML for ${pagePath}, skipping`);
          continue;
        }

        // Generate after HTML by applying design tokens from DESIGN.md
        let designMd = '';
        try { designMd = await readFile('DESIGN.md', 'utf8'); } catch { /* ok */ }
        const afterHtml = applyDesignToPage(beforeHtml, state.dimensions ?? {}, designMd);

        // Persist raw afterHtml so migrate can push it directly (never touch the viewer wrapper)
        await writeFile(`.stardust/prototypes/${slug}.after.html`, afterHtml, 'utf8');

        // Write side-by-side viewer (for human review only — not uploaded to DA)
        const viewer = generatePrototypeViewer(pagePath, beforeHtml, afterHtml, state);
        await writeFile(`.stardust/prototypes/${slug}.html`, viewer, 'utf8');

        // Update page state
        const pg = (state.pages ?? []).find((p) => p.path === pagePath);
        if (pg) pg.status = 'prototyped';

        info(`  prototype: .stardust/prototypes/${slug}.html`);
        generated++;
      }

      await writeJson('.stardust/state.json', state);
      info(`\n${generated} prototype(s) written → .stardust/prototypes/`);
      info('Open in browser, review, then: da stardust migrate [page-path] --commit');
    });

  // ─── migrate ───────────────────────────────────────────────────────────────
  stardust
    .command('migrate [page]')
    .description('Phase 4 — apply approved design to EDS pages via DA API — requires --commit')
    .option('--all', 'Migrate all prototyped pages')
    .option('--branch <branch>', 'Git branch (default: main)')
    .action(async (page, opts) => {
      const { guardWrite } = await import('../lib/mutation.js');
      const { mkdirp, writeJson, readJson } = await fsHelpers();
      const { writeFile, readFile } = await import('node:fs/promises');
      const state = await loadState();

      if ((state.phase ?? 'fresh') !== 'directed' && state.phase !== 'prototyped') {
        console.error('Run `da stardust direct` (and optionally `prototype`) first.');
        process.exit(1);
      }

      await mkdirp('.stardust/migrated');

      const pages = opts.all
        ? (state.pages ?? []).map((p) => p.path)
        : [page ?? (state.pages?.[0]?.path ?? '/index')];

      const { createClient } = await import('../lib/da-client.js');
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});

      let designMd = '';
      try { designMd = await readFile('DESIGN.md', 'utf8'); } catch { /* ok */ }

      let migrated = 0;
      for (const pagePath of pages) {
        if (!guardWrite(`Migrate ${pagePath} to DA`).proceed) continue;

        const slug = pagePath.replace(/\//g, '-').replace(/^-/, '') || 'index';

        // Prefer the raw after HTML persisted by `prototype`; fall back to extracted page
        let sourceHtml = '';
        try {
          sourceHtml = await readFile(`.stardust/prototypes/${slug}.after.html`, 'utf8');
        } catch {
          try {
            sourceHtml = await readFile(`.stardust/current/${slug}.html`, 'utf8');
          } catch {
            info(`  no source HTML for ${pagePath}, skipping`);
            continue;
          }
        }

        const migratedHtml = applyDesignToPage(sourceHtml, state.dimensions ?? {}, designMd);

        // Write to .stardust/migrated/ for local reference
        await writeFile(`.stardust/migrated/${slug}.html`, migratedHtml, 'utf8');

        // Push to DA — only advance state on success
        let pushed = false;
        try {
          await client.sourcePut(pagePath.endsWith('.html') ? pagePath : `${pagePath}.html`, migratedHtml);
          info(`  pushed: ${pagePath} → DA`);

          // Trigger preview
          await client.daPreviewFlush(pagePath);
          await client.helixPreview(pagePath);
          info(`  previewed: ${pagePath}`);
          pushed = true;
        } catch (err) {
          info(`  DA push failed for ${pagePath}: ${err.message}`);
        }

        if (pushed) {
          const pg = (state.pages ?? []).find((p) => p.path === pagePath);
          if (pg) pg.status = 'migrated';
          migrated++;
        }
      }

      if (migrated > 0) {
        state.phase = 'migrated';
        state.migratedAt = new Date().toISOString();
      }
      await writeJson('.stardust/state.json', state);

      info(`\n${migrated} page(s) migrated → DA + Helix preview triggered`);
      info('Publish with: da publish page <path> --commit');
    });

  // ─── reset ─────────────────────────────────────────────────────────────────
  stardust
    .command('reset')
    .description('Reset stardust state back to fresh (does not delete .stardust/ files)')
    .action(async () => {
      const { writeJson } = await fsHelpers();
      await writeJson('.stardust/state.json', freshState());
      info('Stardust state reset to fresh.');
    });

  return stardust;
}

// ── State machine ─────────────────────────────────────────────────────────────

function freshState() {
  return { phase: 'fresh', pages: [], createdAt: new Date().toISOString() };
}

async function loadState() {
  const { readFile, mkdir } = await import('node:fs/promises');
  try {
    await mkdir('.stardust', { recursive: true });
    const raw = await readFile('.stardust/state.json', 'utf8');
    return JSON.parse(raw);
  } catch {
    return freshState();
  }
}

function printStateReport(state) {
  const phase = state.phase ?? 'fresh';
  const phases = ['fresh', 'extracted', 'directed', 'prototyped', 'migrated'];
  const step = phases.indexOf(phase);
  console.log(`Stardust state: ${phase.toUpperCase()}`);
  console.log('');
  console.log(`Progress: ${phases.map((p, i) => i <= step ? `[${p}]` : ` ${p} `).join(' → ')}`);
  if (state.intent) console.log(`\nIntent:  "${state.intent}"`);
  if (state.pageCount) console.log(`Pages:   ${state.pageCount}`);
  if (state.pages?.length) {
    console.log('\nPage status:');
    for (const p of state.pages) console.log(`  ${p.status.padEnd(12)} ${p.path}`);
  }
  console.log('');
  const next = {
    fresh:      'da stardust extract [url]',
    extracted:  'da stardust direct "<intent phrase>"',
    directed:   'da stardust prototype [page]',
    prototyped: 'da stardust migrate [page] --commit',
    migrated:   'da publish pages / (done)',
  }[phase];
  if (next) console.log(`Next:    ${next}`);
}

// ── Crawl helpers ─────────────────────────────────────────────────────────────

async function crawlSite(startUrl, maxPages) {
  const UA = 'Mozilla/5.0 (compatible; da-cli-stardust/0.1)';
  const base = new URL(startUrl);
  const visited = new Set();
  const queue = [startUrl];
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const html = await res.text();
      const path = new URL(url).pathname;
      pages.push({ path, html, source: url });

      // Extract links to same-origin pages
      if (pages.length < maxPages) {
        const linkRe = /href="([^"]+)"/gi;
        let m;
        while ((m = linkRe.exec(html)) !== null) {
          try {
            const linked = new URL(m[1], url);
            if (linked.hostname === base.hostname && !visited.has(linked.href)) {
              queue.push(linked.href);
            }
          } catch { /* invalid URL */ }
        }
      }
    } catch { /* network error, skip */ }
  }
  return pages;
}

// ── Brand extraction ──────────────────────────────────────────────────────────

function extractBrandSurface(pages) {
  const allHtml = pages.map((p) => p.html).join('\n');
  const fonts = new Set();
  const colors = new Set();

  const fontRe = /font-family\s*:\s*['"]?([^'",;\n]+)/gi;
  let m;
  while ((m = fontRe.exec(allHtml)) !== null) {
    const f = m[1].trim().replace(/['"]/g, '').split(',')[0].trim();
    if (f && !['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace'].includes(f.toLowerCase())) {
      fonts.add(f);
    }
  }

  const colorRe = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
  while ((m = colorRe.exec(allHtml)) !== null) colors.add(m[0].toLowerCase());

  const headings = [];
  const h1Re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  while ((m = h1Re.exec(allHtml)) !== null) {
    headings.push(m[1].replace(/<[^>]+>/g, '').trim().slice(0, 120));
  }

  return {
    fonts: [...fonts].slice(0, 5),
    colors: [...colors].slice(0, 20),
    headings: headings.slice(0, 5),
    pageCount: pages.length,
    extractedAt: new Date().toISOString(),
  };
}

// ── Design intent resolution ──────────────────────────────────────────────────

function resolveDimensions(phrase, opts) {
  const p = phrase.toLowerCase();

  // Register
  const register = opts.register ?? (
    /brand|market|campaign|landing|portfolio|agency|creative/i.test(phrase) ? 'brand' : 'product'
  );

  // Tone
  const tone = opts.tone ?? (
    /play|fun|bold|vibrant|energetic|youthful/i.test(phrase) ? 'playful' :
    /serious|trust|enterprise|professional|formal/i.test(phrase) ? 'serious' : 'neutral'
  );

  // Density
  const density = opts.density ?? (
    /dense|data|dashboard|packed|information/i.test(phrase) ? 'packed' :
    /airy|spacious|breathing|minimal|clean/i.test(phrase) ? 'airy' : 'balanced'
  );

  // Expressive axis
  const expressiveAxis =
    /restrained|subtle|quiet|understated|conservative/i.test(phrase) ? 'restrained' :
    /drenched|bold|dramatic|vibrant|saturated|loud/i.test(phrase) ? 'drenched' : 'committed';

  // Distinctiveness
  const distinctiveness =
    /unique|singular|bespoke|custom|unforgettable/i.test(phrase) ? 'singular' :
    /familiar|safe|conventional|standard/i.test(phrase) ? 'familiar' : 'distinctive';

  return { register, tone, density, expressiveAxis, distinctiveness };
}

// Simplified palette selection — in practice would reference the 127-palette library
function selectPalette(intent, dimensions) {
  const p = intent.toLowerCase();
  if (/ocean|sea|water|coastal/i.test(p)) return { name: 'ocean-depths', hue: 'blue', energy: 'calm' };
  if (/forest|nature|organic|green/i.test(p)) return { name: 'forest-floor', hue: 'green', energy: 'grounded' };
  if (/warm|earth|clay|terracotta/i.test(p)) return { name: 'warm-clay', hue: 'orange', energy: 'warm' };
  if (/dark|night|moody|deep/i.test(p)) return { name: 'midnight-noir', hue: 'cool-neutral', energy: 'dramatic' };
  if (/minimal|white|clean|stark/i.test(p)) return { name: 'stark-white', hue: 'none', energy: 'pure' };
  if (dimensions.tone === 'playful') return { name: 'citrus-pop', hue: 'yellow-orange', energy: 'energetic' };
  if (dimensions.tone === 'serious') return { name: 'slate-authority', hue: 'blue-grey', energy: 'composed' };
  return { name: 'balanced-neutral', hue: 'cool-grey', energy: 'balanced' };
}

// ── Content generation ────────────────────────────────────────────────────────

function generateProductMd(brand, pages) {
  return `# PRODUCT.md — Current State (extracted by stardust)

## Site Overview
Pages extracted: ${pages.length}
Extracted: ${new Date().toISOString()}

## Current Brand Surface
Fonts detected: ${brand.fonts.join(', ') || 'none'}
Colors detected: ${brand.colors.slice(0, 8).join(', ') || 'none'}

## Key Headings
${brand.headings.map((h) => `- "${h}"`).join('\n') || '(none detected)'}

## Notes
This file was auto-generated by \`da stardust extract\`.
Edit to reflect actual brand positioning before running \`da stardust direct\`.
`;
}

function generateDesignMd(brand) {
  return `# DESIGN.md — Current State (extracted by stardust)

## Typography
Primary font: ${brand.fonts[0] ?? 'system-ui'}
Secondary font: ${brand.fonts[1] ?? 'none'}

## Color
Detected brand colors:
${brand.colors.slice(0, 6).map((c) => `- ${c}`).join('\n') || '(none)'}

## Notes
Auto-generated by \`da stardust extract\`. Run \`da stardust direct\` to produce target design spec.
`;
}

function generateTargetProductMd(intent, dimensions) {
  return `# PRODUCT.md — Target Design Direction

## Intent
${intent}

## Register
${dimensions.register === 'brand' ? 'Brand register — design IS the product (marketing, portfolio)' : 'Product register — design SERVES the product (tools, apps, docs)'}

## Audience
Derived from intent phrase. Refine as needed.

## Constraints
- Accessibility-first (WCAG 2.1 AA)
- Performance-first (Core Web Vitals green)
- Content-preserving migration

## Generated
${new Date().toISOString()}
`;
}

function generateTargetDesignMd(dimensions, palette) {
  return `# DESIGN.md — Target Design Specification

## Dimensions
- Register: ${dimensions.register}
- Tone: ${dimensions.tone}
- Density: ${dimensions.density}
- Expressive axis: ${dimensions.expressiveAxis}
- Distinctiveness: ${dimensions.distinctiveness}

## Palette
Name: ${palette.name}
Hue bias: ${palette.hue ?? 'neutral'}
Energy: ${palette.energy ?? 'balanced'}

## Typography
Scale: fluid (clamp-based), min 1.25 ratio
Line length: 65–75ch for prose
Leading: 1.5× for body, 1.1× for display

## Color (Custom Properties)
:root {
  --color-brand-primary: /* fill from palette ${palette.name} */;
  --color-brand-secondary: /* fill from palette */;
  --color-surface: #ffffff;
  --color-text: oklch(15% 0 0);
  --space-unit: 1rem;
  --type-scale-base: 1rem;
}

## Laws (impeccable)
- No gradient text
- No glassmorphism
- No layout transitions
- No bounce easing
- No pure #000 background
- No generic CTAs

## Generated
${new Date().toISOString()}
`;
}

function formatDirectionMd(intent, dimensions, palette) {
  return `# Stardust Direction — Reasoning Trace

## User Intent
"${intent}"

## Dimension Analysis
| Dimension       | Value               | Reasoning |
|-----------------|---------------------|-----------|
| Register        | ${dimensions.register}  | derived from intent keywords |
| Tone            | ${dimensions.tone}      | derived from intent keywords |
| Density         | ${dimensions.density}   | derived from intent keywords |
| Expressive axis | ${dimensions.expressiveAxis} | derived from vocabulary |
| Distinctiveness | ${dimensions.distinctiveness} | derived from vocabulary |

## Palette Selection
**${palette.name}** — hue: ${palette.hue ?? 'neutral'}, energy: ${palette.energy ?? 'balanced'}

## Next Steps
1. Review PRODUCT.md and DESIGN.md at project root
2. Adjust any dimension that doesn't match your intent
3. Run \`da stardust prototype\` to generate before/after HTML viewers

## Generated
${new Date().toISOString()}
`;
}

// ── Design application ────────────────────────────────────────────────────────

function applyDesignToPage(html, dimensions, designMd) {
  // Extract CSS tokens from DESIGN.md :root block
  const tokenBlock = designMd.match(/:root\s*\{([^}]+)\}/);
  const tokenCss = tokenBlock ? `:root { ${tokenBlock[1]} }` : '';

  // Inject design token style tag into <head> or prepend
  const styleTag = tokenCss ? `<style id="stardust-tokens">${tokenCss}</style>` : '';
  const densityClass = dimensions.density ?? 'balanced';
  const toneClass = dimensions.tone ?? 'neutral';

  if (html.includes('</head>')) {
    return html.replace('</head>', `${styleTag}\n</head>`)
      .replace(/<body([^>]*)>/, `<body$1 data-stardust-density="${densityClass}" data-stardust-tone="${toneClass}">`);
  }
  return `${styleTag}\n${html}`;
}

// ── Prototype viewer ──────────────────────────────────────────────────────────

function generatePrototypeViewer(path, beforeHtml, afterHtml, state) {
  const intent = state.intent ?? '(no intent set)';
  const palette = state.palette?.name ?? '';
  const ts = new Date().toLocaleDateString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stardust Prototype — ${path}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; }
    body { font: 14px/1.5 system-ui, sans-serif; background: #0a0a0a; color: #f0f0f0; }
    header { padding: 12px 20px; background: #1a1a1a; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 14px; font-weight: 600; }
    header .meta { font-size: 12px; color: #888; }
    .panels { display: grid; grid-template-columns: 1fr 1fr; height: calc(100vh - 49px); }
    .panel { display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid #333; }
    .panel-label { padding: 8px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; background: #111; border-bottom: 1px solid #333; }
    .panel-label.before { color: #888; }
    .panel-label.after { color: #60a5fa; }
    iframe { flex: 1; border: none; background: #fff; }
    .approve-bar { position: fixed; bottom: 0; right: 0; padding: 12px; background: #1a1a1a; border-top: 1px solid #333; border-left: 1px solid #333; display: flex; gap: 8px; }
    button { padding: 6px 14px; border: none; border-radius: 4px; font: 13px system-ui; cursor: pointer; }
    .approve { background: #3b82f6; color: #fff; }
    .reject { background: #333; color: #ccc; }
  </style>
</head>
<body>
  <header>
    <h1>Stardust Prototype</h1>
    <span class="meta">${path} · ${ts} · intent: "${intent}"${palette ? ` · palette: ${palette}` : ''}</span>
  </header>
  <div class="panels">
    <div class="panel">
      <div class="panel-label before">Before (current)</div>
      <iframe srcdoc="${escHtml(beforeHtml)}" title="Before"></iframe>
    </div>
    <div class="panel">
      <div class="panel-label after">After (proposed)</div>
      <!-- stardust:after -->
      <iframe srcdoc="${escHtml(afterHtml)}" title="After"></iframe>
      <!-- /stardust:after -->
    </div>
  </div>
  <div class="approve-bar">
    <button class="approve" onclick="alert('Mark approved in state: da stardust migrate ${path} --commit')">Approve → Migrate</button>
    <button class="reject" onclick="history.back()">Revise</button>
  </div>
</body>
</html>`;
}

function escHtml(html) {
  return html.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── FS helpers ────────────────────────────────────────────────────────────────

async function fsHelpers() {
  const { writeFile, readFile, mkdir } = await import('node:fs/promises');
  return {
    async mkdirp(dir) { await mkdir(dir, { recursive: true }); },
    async writeJson(path, data) { await writeFile(path, JSON.stringify(data, null, 2), 'utf8'); },
    async readJson(path) {
      try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
    },
  };
}

async function promptPhrase() {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question('Redesign intent (describe what you want): ', (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}
