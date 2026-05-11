import { Command } from 'commander';
import { createClient, DaApiError } from '../lib/da-client.js';
import { print, info } from '../lib/output.js';
import { guardWrite } from '../lib/mutation.js';

const CONCURRENCY = 10;

export function makeRouteCommand() {
  const route = new Command('route').description('Classify and manage DA route ownership');

  // ─── classify ──────────────────────────────────────────────────────────────
  route
    .command('classify <path>')
    .description('Probe route ownership: contentbus | codebus | hybrid | orphan')
    .action(async (path) => {
      const client = await createClient();
      const verdict = await classify(client, path);
      print(verdict);
      // Non-zero exit for codebus/hybrid so shell scripts can branch on it
      if (verdict.ownership === 'orphan') process.exit(2);
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
  // Probe DA source (try .html path first, then bare path) and Helix status in parallel
  const [sourceResult, statusResult] = await Promise.allSettled([
    probeSource(client, path),
    client.helixPreviewStatus(path),
  ]);

  const { hasSource, sourcePath } = sourceResult.value ?? { hasSource: false, sourcePath: path };
  const helixStatus = statusResult.value ?? {};

  const sourceLocation =
    helixStatus.preview?.sourceLocation ??
    helixStatus.live?.sourceLocation ?? '';
  const previewStatus = helixStatus.preview?.status ?? 0;
  const liveStatus = helixStatus.live?.status ?? 0;

  const isDAContent = sourceLocation.includes('content.da.live');
  // Code-backed: served from GitHub (sourceLocation is a raw GitHub URL or similar non-DA URL)
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
  const data = await client.list(prefix.replace(/\/$/, ''));
  const items = Array.isArray(data) ? data : (data?.sources ?? []);
  return items
    .filter((s) => s.ext)
    .map((s) => s.path.replace(`/${client.org}/${client.repo}`, ''));
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
