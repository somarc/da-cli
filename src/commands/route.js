import { Command } from 'commander';
import {
  buildLiveUrl,
  buildPlainHtmlUrl,
  buildPreviewUrl,
  canonicalWebPath,
  createClient,
  DaApiError,
} from '../lib/da-client.js';
import { print, info } from '../lib/output.js';
import { guardWrite } from '../lib/mutation.js';

const CONCURRENCY = 10;

export function makeRouteCommand() {
  const route = new Command('route').description('Classify and manage DA route ownership');

  // ─── classify ──────────────────────────────────────────────────────────────
  // Exit-code contract (for shell scripting):
  //   0 = contentbus   (DA-owned, safe to do DA operations)
  //   2 = orphan       (no owner found)
  //   3 = codebus      (code-repo owned)
  //   4 = hybrid       (both DA source and code-repo content present)
  //   5 = probe-failed (API error — classification is incomplete, do not act)
  //   1 = uncaught runtime error (Node default)
  route
    .command('classify <path>')
    .description('Probe route ownership: contentbus | codebus | hybrid | orphan | probe-failed')
    .action(async (path) => {
      const client = await createClient();
      const verdict = await classify(client, path);
      print(verdict);
      const exitCodes = { contentbus: 0, orphan: 2, codebus: 3, hybrid: 4, 'probe-failed': 5 };
      const code = exitCodes[verdict.ownership] ?? 1;
      if (code !== 0) process.exit(code);
    });

  // ─── canonical ─────────────────────────────────────────────────────────────
  route
    .command('canonical <path>')
    .description('Show DA source path, canonical browser URL, preview/live URLs, and .plain.html URL for a route')
    .option('--branch <branch>', 'Git branch (overrides config.branch, default: main)')
    .action(async (path, opts) => {
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      const verdict = await classify(client, path);
      const sourcePath = verdict.sourcePath ?? path;
      const canonical = canonicalWebPath(sourcePath);
      const notes = [];
      if (/\/index(?:\.html)?$/.test(sourcePath)) {
        notes.push('Open the trailing-slash canonical URL; explicit /index can return no-index.');
      }
      if (verdict.preview === 200 && verdict.live !== 200) {
        notes.push('Preview is current but live is not; run `da publish page` or `da publish tree` when ready.');
      }
      if (verdict.ownership === 'orphan') {
        notes.push('Route is orphaned; check DA source path and preview the .html document.');
      }

      print({
        input: path,
        sourcePath,
        canonicalPath: canonical,
        ownership: verdict.ownership,
        daSource: verdict.daSource,
        previewStatus: verdict.preview,
        liveStatus: verdict.live,
        sourceLocation: verdict.sourceLocation,
        previewUrl: buildPreviewUrl(client, sourcePath),
        liveUrl: buildLiveUrl(client, sourcePath),
        plainHtmlUrl: buildPlainHtmlUrl(client, sourcePath),
        notes,
      });
    });

  // ─── audit ─────────────────────────────────────────────────────────────────
  route
    .command('audit')
    .description('Classify every route under a path prefix')
    .option('--prefix <prefix>', 'DA path prefix to audit', '/')
    .option('--concurrency <n>', 'Max parallel probes', String(CONCURRENCY))
    .action(async (opts) => {
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || CONCURRENCY);
      const client = await createClient();

      info(`Listing routes under ${opts.prefix}…`);
      const paths = await listAllPaths(client, opts.prefix);
      if (paths.length === 0) { info('No paths found.'); return; }

      info(`Classifying ${paths.length} route(s) with concurrency ${concurrency}…`);
      const results = await runConcurrent(
        paths.map((p) => () => classify(client, p).catch((e) => ({
          path: p, ownership: 'error', error: e.message,
        }))),
        concurrency,
      );

      print(results.map(({ path, ownership, daSource, preview, live }) =>
        ({ path, ownership, daSource, preview, live }),
      ));
    });

  // ─── clean ─────────────────────────────────────────────────────────────────
  route
    .command('clean <path>')
    .description('Delete DA source for a route and flush preview — dry-run default')
    .option('--force', 'Skip ownership check (allow cleaning non-orphan contentbus routes)')
    .action(async (path, opts) => {
      const client = await createClient();

      // Always classify first so the dry-run output is informative
      info(`Classifying ${path}…`);
      const verdict = await classify(client, path);
      info(`Ownership: ${verdict.ownership}`);

      if (verdict.ownership === 'probe-failed') {
        console.error(`Classification incomplete for ${path} — API probe failed: ${verdict.probeErrors?.join('; ')}`);
        console.error('Refusing to delete: re-run when the API is reachable.');
        process.exit(5);
      }

      if (!opts.force && verdict.ownership === 'codebus') {
        console.error(`Route ${path} is codebus-owned — deleting DA source would not remove the page.`);
        console.error('Pass --force to proceed anyway.');
        process.exit(1);
      }

      if (!opts.force && verdict.ownership === 'orphan' && !verdict.daSource) {
        info('Route has no DA source — nothing to clean.');
        return;
      }

      if (!guardWrite(`Delete DA source: ${path}`).proceed) return;

      // Determine actual source path (may need .html extension)
      const sourcePath = verdict.sourcePath;
      try {
        await client.sourceDelete(sourcePath);
        info(`Deleted source: ${sourcePath}`);
      } catch (err) {
        if (err instanceof DaApiError && err.status === 404) {
          info('Source already absent.');
        } else {
          throw err;
        }
      }

      // Flush preview cache so the route stops serving stale content
      info('Flushing preview…');
      try {
        await client.daPreviewFlush(sourcePath);
        await client.helixPreview(path);
        info('Preview flushed.');
      } catch {
        info('Preview flush failed (non-fatal).');
      }
    });

  return route;
}

// ── classification engine ────────────────────────────────────────────────────

async function classify(client, path) {
  const [sourceResult, statusResult] = await Promise.allSettled([
    probeSource(client, path),
    client.helixPreviewStatus(path),
  ]);

  const probeErrors = [];

  // Source probe: a non-404 rejection is a real failure, not "no source"
  if (sourceResult.status === 'rejected') {
    probeErrors.push(`source: ${sourceResult.reason?.message ?? sourceResult.reason}`);
  }
  // Helix status probe: any rejection is a real failure
  if (statusResult.status === 'rejected') {
    probeErrors.push(`helix-status: ${statusResult.reason?.message ?? statusResult.reason}`);
  }

  if (probeErrors.length > 0) {
    return { path, ownership: 'probe-failed', probeErrors, daSource: null, sourcePath: path };
  }

  const { hasSource, sourcePath } = sourceResult.value;
  const helixStatus = statusResult.value;

  const sourceLocation =
    helixStatus.preview?.sourceLocation ??
    helixStatus.live?.sourceLocation ?? '';
  const previewStatus = helixStatus.preview?.status ?? 0;
  const liveStatus = helixStatus.live?.status ?? 0;

  const isDAContent = sourceLocation.includes('content.da.live');
  const isCodeContent = sourceLocation.startsWith('https://') && !isDAContent;

  let ownership;
  if ((hasSource || isDAContent) && isCodeContent) ownership = 'hybrid';
  else if (hasSource || isDAContent) ownership = 'contentbus';
  else if (isCodeContent) ownership = 'codebus';
  else ownership = 'orphan';

  return {
    path,
    ownership,
    daSource: hasSource,
    sourcePath,
    preview: previewStatus,
    live: liveStatus,
    sourceLocation: sourceLocation || null,
  };
}

async function probeSource(client, path) {
  // Try both with and without .html extension
  const candidates = path.endsWith('.html')
    ? [path]
    : [path + '.html', path];

  for (const p of candidates) {
    try {
      await client.sourceGet(p);
      return { hasSource: true, sourcePath: p };
    } catch (err) {
      if (err instanceof DaApiError && err.status === 404) continue;
      throw err;
    }
  }
  return { hasSource: false, sourcePath: candidates[0] };
}

async function listAllPaths(client, prefix) {
  const results = [];
  const queue = [prefix.replace(/\/$/, '') || '/'];
  while (queue.length) {
    const current = queue.shift();
    const data = await client.list(current);
    const items = Array.isArray(data) ? data : (data?.sources ?? []);
    for (const item of items) {
      if (item.ext) {
        results.push(item.path.replace(`/${client.org}/${client.repo}`, ''));
      } else {
        // Directory — recurse
        queue.push(item.path.replace(`/${client.org}/${client.repo}`, ''));
      }
    }
  }
  return results;
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

// ── test exports (not part of the public CLI surface) ─────────────────────────
export { classify, listAllPaths };
