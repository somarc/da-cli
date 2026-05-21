import { Command } from 'commander';
import path from 'node:path';
import { resolveConfig } from '../lib/config.js';
import { info, print, warn } from '../lib/output.js';
import { buildFallbackBaseUrl, hasContentWorkspace, startLocalServer } from '../lib/local-server.js';

export function makeUpCommand() {
  const up = new Command('up')
    .description('Run an agent-friendly local EDS server for this repo')
    .option('-p, --port <port>', 'Port to listen on', parsePort, 3000)
    .option('--host <host>', 'Host to bind', '127.0.0.1')
    .option('--root <dir>', 'Code repository root to serve', '.')
    .option('--content <dir>', 'Local DA content workspace directory', 'content')
    .option('--fallback <mode>', 'Fallback for missing local files: preview | live | none', 'preview')
    .option('--branch <branch>', 'EDS branch for preview/live fallback')
    .option('--no-content', 'Disable local content/ workspace lookup')
    .action(async (opts) => {
      if (!['preview', 'live', 'none'].includes(opts.fallback)) {
        throw new Error('--fallback must be preview, live, or none');
      }

      const cfg = await resolveConfig({ branch: opts.branch });
      const root = path.resolve(opts.root);
      const contentDir = opts.content === false ? null : path.resolve(opts.content);
      const contentEnabled = Boolean(contentDir && await hasContentWorkspace(contentDir));
      const fallbackBaseUrl = buildFallbackBaseUrl({
        org: cfg.org,
        repo: cfg.repo,
        branch: cfg.config?.branch ?? 'main',
        fallback: opts.fallback,
      });

      if (opts.fallback !== 'none' && !fallbackBaseUrl) {
        warn('Remote fallback disabled because org or repo is not configured.');
      }
      if (contentDir && !contentEnabled) {
        info(`No content workspace found at ${contentDir}; serving code files first.`);
      }

      const server = await startLocalServer({
        host: opts.host,
        port: opts.port,
        root,
        content: contentEnabled ? contentDir : null,
        fallback: opts.fallback,
        fallbackBaseUrl,
      });

      const address = server.address();
      const url = `http://${address.address === '::' ? 'localhost' : address.address}:${address.port}`;
      print({
        status: 'ready',
        url,
        root,
        content: contentEnabled ? contentDir : '',
        fallback: fallbackBaseUrl ?? 'none',
        priority: sourcePriority(contentEnabled, Boolean(fallbackBaseUrl)),
      });
      info('Press Ctrl+C to stop.');

      await waitForShutdown(server);
    });

  return up;
}

function sourcePriority(contentEnabled, fallbackEnabled) {
  return [
    'local code',
    ...(contentEnabled ? ['local content'] : []),
    ...(fallbackEnabled ? ['fallback'] : []),
  ].join(' -> ');
}

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

async function waitForShutdown(server) {
  await new Promise((resolve) => {
    const close = () => {
      server.close(() => resolve());
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}
