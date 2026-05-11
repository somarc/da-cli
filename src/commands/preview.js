import { Command } from 'commander';
import { createClient, DaApiError } from '../lib/da-client.js';
import { print, info, verbose } from '../lib/output.js';

export function makePreviewCommand() {
  const preview = new Command('preview').description('Trigger EDS preview pipeline via Helix admin');

  // ─── page ──────────────────────────────────────────────────────────────────
  preview
    .command('page <path>')
    .description('Preview a single page — flushes DA cache then triggers Helix pipeline')
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
    .description('Batch preview — reads paths from a file (one per line) or a /prefix/ for all pages under it')
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

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolvePaths(source) {
  const { statSync } = await import('node:fs');
  try {
    if (statSync(source).isFile()) {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(source, 'utf8');
      return text.split('\n').map((l) => l.trim()).filter(Boolean);
    }
  } catch {
    // not a local file — fall through to DA prefix listing
  }

  // Treat as a DA path prefix — list and collect all file paths under it
  const client = await createClient();
  const prefix = source.replace(/\*$/, '').replace(/\/$/, '');
  const data = await client.list(prefix);
  const items = Array.isArray(data) ? data : (data?.sources ?? []);
  return items
    .filter((s) => s.ext)
    .map((s) => s.path.replace(`/${client.org}/${client.repo}`, ''));
}

// Simple manual concurrency pool — no external deps
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
