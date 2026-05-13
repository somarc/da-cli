import { readFileSync, readFile as readFileCb } from 'node:fs';
import { promisify } from 'node:util';
import express from 'express';
import { paymentMiddleware } from 'x402-express';
import { ROUTE_CATALOG, toMiddlewareConfig } from './catalog.js';
import { buildFlags, hasApprovalGates, runDaCommand, withTempFile, resolvePipelineName } from './runner.js';
import { agentCard } from './agent-card.js';

const readFile = promisify(readFileCb);
const { version: PKG_VERSION } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url))
);

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
const NETWORK = process.env.X402_NETWORK || 'base';

export function createServer({ walletAddress } = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const addr = walletAddress ?? process.env.X402_WALLET_ADDRESS;
  const paymentEnabled = !!addr;

  // ── Discovery endpoints (free — registered before payment middleware) ────────
  app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      name: '@somarc/da-cli API',
      version: PKG_VERSION,
      docs: 'https://main--da-cli-eds--somarc.aem.live/commands',
      agentCard: `${baseUrl}/.well-known/x402`,
      health: `${baseUrl}/v1/health`,
      paymentEnabled,
    });
  });

  app.get('/.well-known/x402', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(agentCard(baseUrl, { version: PKG_VERSION, paymentEnabled }));
  });

  app.get('/v1/health', (req, res) =>
    res.json({ status: 'ok', ts: new Date().toISOString() })
  );

  // ── x402 payment middleware (gates all routes registered after this) ─────────
  if (paymentEnabled) {
    app.use(
      paymentMiddleware(
        addr,
        toMiddlewareConfig(ROUTE_CATALOG, NETWORK),
        { url: FACILITATOR_URL }
      )
    );
  }

  // ── Content ──────────────────────────────────────────────────────────────────
  app.post('/v1/content/list', async (req, res) => {
    const { path = '/', ...body } = req.body ?? {};
    const result = await runDaCommand(['content', 'list', path], buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/content/get', async (req, res) => {
    const { path, ...body } = req.body ?? {};
    if (!path) return res.status(400).json({ error: 'path required' });
    const result = await runDaCommand(['content', 'get', path], buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/content/put', async (req, res) => {
    const { path, content, ...body } = req.body ?? {};
    if (!path || !content) return res.status(400).json({ error: 'path and content required' });
    const result = await withTempFile(content, '.html', (tmpPath) =>
      runDaCommand(['content', 'put', path, tmpPath], buildFlags(body))
    );
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── Preview / Publish / Deploy ───────────────────────────────────────────────
  app.post('/v1/preview', async (req, res) => {
    const { path, ...body } = req.body ?? {};
    if (!path) return res.status(400).json({ error: 'path required' });
    const result = await runDaCommand(['preview', 'page', path], buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/publish', async (req, res) => {
    const { path, ...body } = req.body ?? {};
    if (!path) return res.status(400).json({ error: 'path required' });
    const result = await runDaCommand(['publish', 'page', path], buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/deploy', async (req, res) => {
    const { path, ...body } = req.body ?? {};
    if (!path) return res.status(400).json({ error: 'path required' });
    const result = await runDaCommand(['deploy', 'page', path], buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── Stardust ─────────────────────────────────────────────────────────────────
  app.post('/v1/stardust/extract', async (req, res) => {
    const { url, ...body } = req.body ?? {};
    const cmd = url ? ['stardust', 'extract', url] : ['stardust', 'extract'];
    const result = await runDaCommand(cmd, buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/stardust/direct', async (req, res) => {
    const { intent, palette, ...body } = req.body ?? {};
    if (!intent) return res.status(400).json({ error: 'intent required' });
    const flags = buildFlags(body);
    if (palette) flags.push('--palette', palette);
    const result = await runDaCommand(['stardust', 'direct', intent], flags);
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/stardust/migrate', async (req, res) => {
    const { source, ...body } = req.body ?? {};
    const cmd = source ? ['stardust', 'migrate', source] : ['stardust', 'migrate'];
    const result = await runDaCommand(cmd, buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── Pipelines ────────────────────────────────────────────────────────────────
  // /v1/pipeline/run ($0.15) — named pipelines only ({ pipeline: "name" }).
  // Submitting { yaml } here returns 400 with an explicit redirect to /custom,
  // so agents discover the premium endpoint rather than hitting the wrong tier.
  app.post('/v1/pipeline/run', async (req, res) => {
    const { pipeline: pipelineName, yaml, ...body } = req.body ?? {};

    if (yaml) {
      return res.status(400).json({
        error: 'Custom YAML pipelines must use POST /v1/pipeline/custom ($0.25)',
        hint: 'POST /v1/pipeline/run accepts only named pipelines ({ pipeline: "name" }). Submit { yaml } to POST /v1/pipeline/custom for the agent-authored pipeline capability.',
      });
    }

    if (!pipelineName) {
      return res.status(400).json({
        error: 'pipeline name required',
        hint: 'Pass { pipeline: "name" } to run a named pipeline, or use POST /v1/pipeline/custom with { yaml } for a custom YAML pipeline.',
      });
    }

    const pipelineFile = await resolvePipelineName(pipelineName);
    if (!pipelineFile) {
      return res.status(404).json({
        error: `Pipeline '${pipelineName}' not found in ~/.da/pipelines/`,
        hint: 'To run a custom pipeline, use POST /v1/pipeline/custom with a { yaml } body.',
      });
    }

    let yamlContent;
    try {
      yamlContent = await readFile(pipelineFile, 'utf8');
    } catch {
      return res.status(500).json({ error: 'Failed to read named pipeline file' });
    }

    if (hasApprovalGates(yamlContent)) {
      return res.status(422).json({
        error: 'Pipeline contains requires_approval steps — cannot execute via HTTP (stdin is detached)',
        hint: 'Remove requires_approval from pipeline steps to run via the API.',
      });
    }

    const result = await withTempFile(yamlContent, '.yaml', (tmpPath) =>
      runDaCommand(['pipeline', 'run', tmpPath], buildFlags(body))
    );
    res.status(result.ok ? 200 : 500).json(result);
  });

  // /v1/pipeline/custom ($0.25) — agent-authored YAML pipelines ({ yaml }).
  // This is the premium tier: agents compose any sequence of DA operations.
  app.post('/v1/pipeline/custom', async (req, res) => {
    const { yaml, ...body } = req.body ?? {};
    if (!yaml) {
      return res.status(400).json({
        error: 'yaml required — submit your full pipeline YAML descriptor in the yaml field',
      });
    }
    if (hasApprovalGates(yaml)) {
      return res.status(422).json({
        error: 'Pipeline contains requires_approval steps — cannot execute via HTTP (stdin is detached)',
        hint: 'Remove requires_approval from pipeline steps to run via the API.',
      });
    }
    const result = await withTempFile(yaml, '.yaml', (tmpPath) =>
      runDaCommand(['pipeline', 'run', tmpPath], buildFlags(body))
    );
    res.status(result.ok ? 200 : 500).json(result);
  });

  // ── 404 ──────────────────────────────────────────────────────────────────────
  app.use((req, res) =>
    res.status(404).json({ error: `${req.method} ${req.path} not found` })
  );

  return app;
}
