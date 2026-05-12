import { Command } from 'commander';
import { createClient, DaApiError } from '../lib/da-client.js';
import { print, info } from '../lib/output.js';

export function makeCodeCommand() {
  const code = new Command('code').description('EDS code-bus operations — sync and inspect code assets');

  // ─── sync ──────────────────────────────────────────────────────────────────
  code
    .command('sync [path]')
    .description('Trigger code-bus sync for a path (or all if omitted) — invalidates CDN for JS/CSS/HTML assets')
    .option('--branch <branch>', 'Git branch (default: main)')
    .action(async (path = '/', opts) => {
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      info(`Syncing code bus: ${path}`);
      try {
        const result = await client.helixCodeSync(path);
        print(result ?? { path, status: 'queued' });
      } catch (err) {
        handleApiError(err, path);
      }
    });

  // ─── status ────────────────────────────────────────────────────────────────
  code
    .command('status [path]')
    .description('Check code-bus sync status for a path')
    .option('--branch <branch>', 'Git branch (default: main)')
    .action(async (path = '/', opts) => {
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      try {
        const result = await client.helixCodeStatus(path);
        print(result);
      } catch (err) {
        handleApiError(err, path);
      }
    });

  // ─── job ───────────────────────────────────────────────────────────────────
  code
    .command('job <jobId>')
    .description('Poll status of an async Helix admin job by ID')
    .option('--wait', 'Block until the job reaches a terminal state')
    .option('--timeout <seconds>', 'Max seconds to wait (with --wait)', '120')
    .action(async (jobId, opts) => {
      const client = await createClient();
      try {
        if (opts.wait) {
          info(`Waiting on job ${jobId}…`);
          const result = await client.helixJobWait(jobId, {
            timeoutMs: parseInt(opts.timeout, 10) * 1000,
          });
          print(result);
        } else {
          const result = await client.helixJob(jobId);
          print(result);
        }
      } catch (err) {
        handleApiError(err, jobId);
      }
    });

  // ─── sidekick ──────────────────────────────────────────────────────────────
  const sidekick = code
    .command('sidekick')
    .description('Read or update the Helix sidekick configuration for this repo');

  sidekick
    .command('get')
    .description('Print current sidekick config as JSON')
    .action(async () => {
      const client = await createClient();
      try {
        const result = await client.helixSidekickConfig();
        print(result);
      } catch (err) {
        handleApiError(err, 'sidekick config');
      }
    });

  sidekick
    .command('set <json>')
    .description('Merge JSON into sidekick config — requires --commit')
    .action(async (json) => {
      const { guardWrite } = await import('../lib/mutation.js');
      if (!guardWrite('Update sidekick config').proceed) return;
      let cfg;
      try {
        cfg = JSON.parse(json);
      } catch {
        console.error('Invalid JSON');
        process.exit(1);
      }
      const client = await createClient();
      try {
        const result = await client.helixSidekickUpdate(cfg);
        print(result ?? { status: 'updated' });
      } catch (err) {
        handleApiError(err, 'sidekick config');
      }
    });

  // ─── cache ─────────────────────────────────────────────────────────────────
  code
    .command('purge <path>')
    .description('Purge CDN cache for a path — requires --commit')
    .option('--branch <branch>', 'Git branch (default: main)')
    .action(async (path, opts) => {
      const { guardWrite } = await import('../lib/mutation.js');
      if (!guardWrite(`Cache purge: ${path}`).proceed) return;
      const client = await createClient(opts.branch ? { branch: opts.branch } : {});
      try {
        const result = await client.helixCachePurge(path);
        print(result ?? { path, status: 'purged' });
      } catch (err) {
        handleApiError(err, path);
      }
    });

  return code;
}

function handleApiError(err, target) {
  if (err instanceof DaApiError) {
    if (err.status === 401) console.error('Unauthorized — run `da auth login`');
    else if (err.status === 404) console.error(`Not found: ${target}`);
    else console.error(err.message);
  } else {
    console.error(err.message);
  }
  process.exit(1);
}
