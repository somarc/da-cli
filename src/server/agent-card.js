const SERVICE_VERSION = '0.1.0';

export function agentCard(baseUrl = 'http://localhost:3402') {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'DA CLI — Agentic DA Workflow Platform',
    description:
      'HTTP API for Adobe Document Authoring + Edge Delivery Services. ' +
      'Supports content CRUD, preview, publish, deploy, Stardust AI redesign, ' +
      'and custom YAML pipeline execution. The highest-value capability is ' +
      'POST /v1/pipeline/custom — agents can submit their own YAML pipeline ' +
      'descriptors to compose complex multi-step DA workflows with dependencies, ' +
      'parallelism, and approval gates.',
    services: [
      {
        name: 'web',
        endpoint: baseUrl,
        version: SERVICE_VERSION,
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
    x402Support: true,
    active: true,
    endpoints: {
      'POST /v1/content/list': {
        price: '$0.001',
        description: 'List DA documents at a given path',
        body: { org: 'string', repo: 'string', path: 'string?', env: 'string?' },
      },
      'POST /v1/content/get': {
        price: '$0.001',
        description: 'Fetch a DA document',
        body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
      },
      'POST /v1/content/put': {
        price: '$0.002',
        description: 'Write an HTML document to DA source',
        body: { org: 'string', repo: 'string', path: 'string', content: 'string (HTML)', env: 'string?' },
      },
      'POST /v1/preview': {
        price: '$0.04',
        description: 'Trigger Helix preview cache flush for a page',
        body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
      },
      'POST /v1/publish': {
        price: '$0.04',
        description: 'Promote a page to *.aem.live CDN',
        body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
      },
      'POST /v1/deploy': {
        price: '$0.06',
        description: 'Preview + publish in one atomic step',
        body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
      },
      'POST /v1/stardust/extract': {
        price: '$0.05',
        description: 'Stardust: extract brand context from a site URL',
        body: { org: 'string', repo: 'string', url: 'string?', env: 'string?' },
      },
      'POST /v1/stardust/direct': {
        price: '$0.07',
        description: 'Stardust: produce a target design spec from an AI redesign intent',
        body: { org: 'string', repo: 'string', intent: 'string', palette: 'string?', env: 'string?' },
      },
      'POST /v1/stardust/migrate': {
        price: '$0.05',
        description: 'Stardust: migrate content to the new design spec',
        body: { org: 'string', repo: 'string', source: 'string?', env: 'string?' },
      },
      'POST /v1/pipeline/run': {
        price: '$0.15',
        description: 'Execute a named built-in pipeline from ~/.da/pipelines/',
        body: { pipeline: 'string (pipeline name)', org: 'string?', repo: 'string?', env: 'string?' },
      },
      'POST /v1/pipeline/custom': {
        price: '$0.25',
        description:
          'Execute a custom agent-authored YAML pipeline — highest-value capability. ' +
          'Submit a full pipeline YAML descriptor with steps, dependencies, parallelism, ' +
          'and approval gates. Agents are free to compose any sequence of DA operations.',
        body: { yaml: 'string (full pipeline YAML)', org: 'string?', repo: 'string?', env: 'string?' },
      },
    },
  };
}
