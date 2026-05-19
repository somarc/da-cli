import { Command } from 'commander';
import { createClient, DaApiError, buildPlainHtmlUrl } from '../lib/da-client.js';
import { print, info, verbose } from '../lib/output.js';
import { resolvePaths, runConcurrent } from '../lib/paths.js';

export function makePreviewCommand() {
  const preview = new Command('preview').description('Trigger EDS preview pipeline — updates *.aem.page only; run `da publish` to promote to *.aem.live');

  // ─── page ──────────────────────────────────────────────────────────────────
  preview
    .command('page <path>')
    .description('Preview a single page — flushes DA cache then triggers Helix pipeline (*.aem.page only; use publish to go live)')
    .option('--branch <branch>', 'Git branch (overrides config.branch, default: main)')
    .action(async (path, opts) => {
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});

      // Step 1: flush DA editor cache (best-effort; failure does not block EDS preview)
      try {
        await client.daPreviewFlush(path);
        verbose(`DA preview flushed: ${path}`);
      } catch (err) {
        verbose(`DA flush skipped: ${err.message}`);
      }

      // Step 2: trigger Helix/EDS content pipeline
      info(`Triggering preview: ${path}`);
      try {
        const result = await client.helixPreview(path);
        const url = result?.preview?.url;
        if (url) {
          console.log(url);
          await verifyContentPipeline(client, path, url);
        } else {
          print(result);
        }
      } catch (err) {
        handleApiError(err, path);
      }
    });

  // ─── pages ─────────────────────────────────────────────────────────────────
  preview
    .command('pages <source>')
    .description('Batch preview — reads paths from a file (one per line) or a /prefix/ for all pages (*.aem.page only; use publish to go live)')
    .option('--concurrency <n>', 'Max parallel requests', '5')
    .option('--branch <branch>', 'Git branch (overrides config.branch, default: main)')
    .action(async (source, opts) => {
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 5);
      const paths = await resolvePaths(source);

      if (paths.length === 0) {
        console.error('No paths found.');
        process.exit(1);
      }

      info(`Previewing ${paths.length} page(s) with concurrency ${concurrency}…`);
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      const results = await runConcurrent(
        paths.map((p) => async () => {
          try {
            const r = await client.helixPreview(p);
            return { path: p, url: r?.preview?.url ?? '', status: 'ok' };
          } catch (err) {
            return { path: p, url: '', status: `error: ${err.message}` };
          }
        }),
        concurrency,
      );

      print(results);
    });

  // ─── tree ──────────────────────────────────────────────────────────────────
  preview
    .command('tree [prefix]')
    .description('Preview every HTML source document under a DA prefix, including nav/footer if present')
    .option('--concurrency <n>', 'Max parallel requests', '5')
    .option('--branch <branch>', 'Git branch (overrides config.branch, default: main)')
    .action(async (prefix = '/', opts) => {
      await previewPathSet(prefix, { ...opts, htmlOnly: true });
    });

  // ─── status ────────────────────────────────────────────────────────────────
  preview
    .command('status <path>')
    .description('Check Helix preview pipeline status for a path')
    .option('--branch <branch>', 'Git branch')
    .action(async (path, opts) => {
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      try {
        const result = await client.helixPreviewStatus(path);
        print(result);
      } catch (err) {
        handleApiError(err, path);
      }
    });

  return preview;
}

async function previewPathSet(source, opts) {
  const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 5);
  const paths = (await resolvePaths(source))
    .filter((p) => !opts.htmlOnly || /\.html$/i.test(p));

  if (paths.length === 0) {
    console.error('No paths found.');
    process.exit(1);
  }

  info(`Previewing ${paths.length} page(s) with concurrency ${concurrency}…`);
  const client = await createClient(opts.branch ? { branch: opts.branch } : {});
  const results = await runConcurrent(
    paths.map((p) => async () => {
      try {
        try {
          await client.daPreviewFlush(p);
        } catch (err) {
          verbose(`DA flush skipped for ${p}: ${err.message}`);
        }
        const r = await client.helixPreview(p);
        return { path: p, url: r?.preview?.url ?? '', status: 'ok' };
      } catch (err) {
        return { path: p, url: '', status: `error: ${err.message}` };
      }
    }),
    concurrency,
  );

  print(results);
  if (results.some((r) => r.status !== 'ok')) process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Exported for testing — pure check with no side effects.
export function isEmptyContent(body) {
  const t = body.trim();
  return t === '' || /^<div>\s*<\/div>$/i.test(t);
}

// Fetch .plain.html and warn if the content pipeline returned empty content.
// Empty means Helix built a preview but extracted nothing from the DA source.
async function verifyContentPipeline(client, path, previewUrl) {
  try {
    const plainUrl = buildPlainHtmlUrl(
      { org: client.org, repo: client.repo, branch: client.branch },
      path,
    );
    const res = await fetch(plainUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return; // 404/5xx — not an empty-content problem
    const body = await res.text();
    if (isEmptyContent(body)) {
      console.error('');
      console.error('Warning: preview URL returned but content pipeline is empty.');
      console.error('Possible causes:');
      console.error('  1. DA document lacks EDS structure — wrap content in <body><header></header><main>...</main><footer></footer></body>');
      console.error('  2. AEM Sync GitHub App not installed — install at https://github.com/apps/aem-sync');
      console.error('  3. fstab.yaml missing or not committed on main');
      console.error(`  Verify: curl "${plainUrl}"`);
    }
  } catch {
    // network error — skip verification silently
  }
}

function handleApiError(err, path) {
  if (err instanceof DaApiError) {
    if (err.status === 401) console.error('Unauthorized — run `da auth login`');
    else if (err.status === 404) console.error(`Not found: ${path}`);
    else console.error(err.message);
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
