import { Command } from 'commander';
import { createClient, DaApiError } from '../lib/da-client.js';
import { print, info } from '../lib/output.js';
import { enforceBulkWriteSafety, guardWrite, printWritePreflight } from '../lib/mutation.js';
import { resolvePaths, runConcurrent } from '../lib/paths.js';

// deploy = preview + publish in one command.
// Preview always runs (it is read-safe). Publish requires --commit.
// Without --commit: previews, prints preview URLs, then shows a dry-run
// summary of what would be published and exits — nothing goes live.

export function makeDeployCommand() {
  const deploy = new Command('deploy')
    .description('Preview then publish in one step — promotes pages to *.aem.live; requires --commit to publish');

  // ─── page ──────────────────────────────────────────────────────────────────
  deploy
    .command('page <path>')
    .description('Preview a single page then promote it to live CDN — publish requires --commit')
    .option('--branch <branch>', 'Git branch (overrides config.branch, default: main)')
    .action(async (path, opts) => {
      const clientOpts = opts.branch ? { branch: opts.branch } : {};
      const client = await createClient(clientOpts);
      printWritePreflight({
        client,
        operation: `deploy page ${path}`,
        paths: [path],
        configSources: client.configSources,
        notes: ['Preview runs first; publish to live CDN requires --commit.'],
      });

      // Step 1 — flush DA cache (best-effort)
      try { await client.daPreviewFlush(path); } catch { /* non-fatal */ }

      // Step 2 — preview
      info(`Previewing: ${path}`);
      let previewUrl;
      try {
        const result = await client.helixPreview(path);
        previewUrl = result?.preview?.url;
        if (previewUrl) info(`Preview: ${previewUrl}`);
        else print(result);
      } catch (err) {
        handleApiError(err, path);
      }

      // Step 3 — publish (dry-run gate)
      if (!guardWrite(`Publish ${path} to live CDN`).proceed) return;

      info(`Publishing: ${path}`);
      try {
        const result = await client.helixLive(path);
        const liveUrl = result?.live?.url;
        if (liveUrl) console.log(liveUrl);
        else print(result);
      } catch (err) {
        handleApiError(err, path);
      }
    });

  // ─── pages ─────────────────────────────────────────────────────────────────
  deploy
    .command('pages <source>')
    .description('Batch preview then publish — reads paths from a file or a /prefix/ listing; publish requires --commit')
    .option('--concurrency <n>', 'Max parallel requests per phase', '5')
    .option('--branch <branch>', 'Git branch')
    .option('--yes', 'Confirm committed bulk publish after reviewing the preflight')
    .action(async (source, opts) => {
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 5);
      const paths = await resolvePaths(source);

      if (paths.length === 0) {
        console.error('No paths found.');
        process.exit(1);
      }

      const clientOpts = opts.branch ? { branch: opts.branch } : {};
      const client = await createClient(clientOpts);
      printWritePreflight({
        client,
        operation: `deploy pages ${source}`,
        source,
        paths,
        configSources: client.configSources,
        notes: ['Preview runs first; publish to live CDN requires --commit.'],
      });
      const bulkSafety = enforceBulkWriteSafety({
        pathCount: paths.length,
        yes: opts.yes,
        configSources: client.configSources,
        operation: `deploy pages ${source}`,
      });
      if (!bulkSafety.proceed) {
        console.error(bulkSafety.reason);
        process.exit(1);
      }

      // Phase 1 — preview all pages
      info(`[1/2] Previewing ${paths.length} page(s) with concurrency ${concurrency}…`);
      const previewResults = await runConcurrent(
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
      print(previewResults);

      const previewed = previewResults.filter((r) => r.status === 'ok').map((r) => r.path);
      const failed = previewResults.length - previewed.length;
      if (failed > 0) info(`${failed} page(s) failed preview — skipping publish for those paths`);

      // Phase 2 — publish (dry-run gate; only pages that previewed successfully)
      if (!guardWrite(`Publish ${previewed.length} page(s) to live CDN`).proceed) return;

      info(`[2/2] Publishing ${previewed.length} page(s) with concurrency ${concurrency}…`);
      const publishResults = await runConcurrent(
        previewed.map((p) => async () => {
          try {
            const r = await client.helixLive(p);
            return { path: p, url: r?.live?.url ?? '', status: 'ok' };
          } catch (err) {
            return { path: p, url: '', status: `error: ${err.message}` };
          }
        }),
        concurrency,
      );
      print(publishResults);
    });

  return deploy;
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
