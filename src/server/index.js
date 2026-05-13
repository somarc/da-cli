import express from 'express';
import { paymentMiddleware } from 'x402-express';
import { buildFlags, runDaCommand, withTempFile, resolvePipelineName } from './runner.js';
import { agentCard } from './agent-card.js';

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
const NETWORK = process.env.X402_NETWORK || 'base';

export function createServer({ walletAddress } = {}) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // ── Discovery endpoints (free — registered before payment middleware) ────────
  app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      name: '@somarc/da-cli API',
      version: '0.1.0',
      docs: 'https://main--da-cli-eds--somarc.aem.live/commands',
      agentCard: `${baseUrl}/.well-known/x402`,
      health: `${baseUrl}/v1/health`,
    });
  });

  app.get('/.well-known/x402', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(agentCard(baseUrl));
  });

  app.get('/v1/health', (req, res) =>
    res.json({ status: 'ok', ts: new Date().toISOString() })
  );

  // ── x402 payment middleware (gates all routes registered after this) ─────────
  const addr = walletAddress ?? process.env.X402_WALLET_ADDRESS;
  if (addr) {
    app.use(
      paymentMiddleware(
        addr,
        {
          'POST /v1/content/list':     { price: '$0.001', network: NETWORK },
          'POST /v1/content/get':      { price: '$0.001', network: NETWORK },
          'POST /v1/content/put':      { price: '$0.002', network: NETWORK },
          'POST /v1/preview':          { price: '$0.04',  network: NETWORK },
          'POST /v1/publish':          { price: '$0.04',  network: NETWORK },
          'POST /v1/deploy':           { price: '$0.06',  network: NETWORK },
          'POST /v1/stardust/extract': { price: '$0.05',  network: NETWORK },
          'POST /v1/stardust/direct':  { price: '$0.07',  network: NETWORK },
          'POST /v1/stardust/migrate': { price: '$0.05',  network: NETWORK },
          'POST /v1/pipeline/run':     { price: '$0.15',  network: NETWORK },
          'POST /v1/pipeline/custom':  { price: '$0.25',  network: NETWORK },
        },
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
  app.post('/v1/pipeline/run', async (req, res) => {
    const { pipeline: pipelineName, ...body } = req.body ?? {};
    if (!pipelineName) return res.status(400).json({ error: 'pipeline name required' });
    const pipelineFile = await resolvePipelineName(pipelineName);
    if (!pipelineFile) {
      return res.status(404).json({
        error: `Pipeline '${pipelineName}' not found in ~/.da/pipelines/`,
        hint: 'Use POST /v1/pipeline/custom to submit a full YAML pipeline body.',
      });
    }
    const result = await runDaCommand(['pipeline', 'run', pipelineFile], buildFlags(body));
    res.status(result.ok ? 200 : 500).json(result);
  });

  app.post('/v1/pipeline/custom', async (req, res) => {
    const { yaml, ...body } = req.body ?? {};
    if (!yaml) {
      return res.status(400).json({
        error: 'yaml required',
        hint: 'Submit your full pipeline YAML descriptor in the yaml field.',
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
