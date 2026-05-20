import { ROUTE_CATALOG, toEndpointsMap } from './catalog.js';

export function agentCard(baseUrl = 'http://localhost:3402', { version = '0.0.0', paymentEnabled = true } = {}) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'DA CLI — Agentic DA Workflow Platform',
    description:
      'HTTP API for Adobe Document Authoring + Edge Delivery Services. ' +
      'Supports content CRUD, preview, publish, deploy, Stardust AI redesign, ' +
      'and custom YAML pipeline execution. The highest-value capability is ' +
      'POST /v1/pipeline/custom with { yaml } — agents submit their own YAML pipeline ' +
      'descriptors to compose complex multi-step DA workflows with dependencies ' +
      'and parallelism.',
    services: [
      {
        name: 'web',
        endpoint: baseUrl,
        version,
        skills: [
          'content-crud',
          'helix-preview',
          'helix-publish',
          'deploy',
          'stardust-ai-redesign',
          'named-pipeline-execution',
          'custom-yaml-pipeline-execution',
        ],
        domains: ['adobe.com', 'aem.live', 'hlx.page', 'da.live'],
      },
    ],
    x402Support: paymentEnabled,
    active: true,
    endpoints: toEndpointsMap(ROUTE_CATALOG),
  };
}
