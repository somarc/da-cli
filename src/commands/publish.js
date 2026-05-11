import { Command } from 'commander';
import { createClient, DaApiError } from '../lib/da-client.js';
import { print, info } from '../lib/output.js';

export function makePublishCommand() {
  const publish = new Command('publish').description('Promote pages to live CDN via Helix admin');

  // ─── page ──────────────────────────────────────────────────────────────────
  publish
    .command('page <path>')
    .description('Promote a single page to live CDN')
    .option('--branch <branch>', 'Git branch (overrides config.branch, default: main)')
    .action(async (path, opts) => {
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      info(`Publishing: ${path}`);
      try {
        const result = await client.helixLive(path);
        const url = result?.live?.url;
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
  publish
    .command('pages <source>')
    .description('Batch publish — reads paths from a file or a /prefix/ listing')
    .option('--concurrency <n>', 'Max parallel requests', '5')
    .option('--branch <branch>', 'Git branch')
    .action(async (source, opts) => {
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 5);
      const paths = await resolvePaths(source);

      if (paths.length === 0) {
        console.error('No paths found.');
        process.exit(1);
      }

      info(`Publishing ${paths.length} page(s) with concurrency ${concurrency}…`);
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      const results = await runConcurrent(
        paths.map((p) => async () => {
          try {
            const r = await client.helixLive(p);
            return { path: p, url: r?.live?.url ?? '', status: 'ok' };
          } catch (err) {
            return { path: p, url: '', status: `error: ${err.message}` };
          }
        }),
        concurrency,
      );

      print(results);
    });

  // ─── unpublish ─────────────────────────────────────────────────────────────
  publish
    .command('unpublish <path>')
    .description('Remove a page from live CDN — requires --commit')
    .option('--branch <branch>', 'Git branch')
    .action(async (path, opts) => {
      const { guardWrite } = await import('../lib/mutation.js');
      if (!guardWrite(`Unpublish ${path}`).proceed) return;

      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      try {
        await client.helixUnpublish(path);
        info(`Unpublished: ${path}`);
      } catch (err) {
        handleApiError(err, path);
      }
    });

  return publish;
}

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
  const client = await createClient();
  const prefix = source.replace(/\*$/, '').replace(/\/$/, '');
  const data = await client.list(prefix);
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
