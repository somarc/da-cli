// Single source of truth for route pricing and endpoint metadata.
// Both the x402 middleware config and the ERC-8004 agent card are derived
// from this catalog, ensuring advertised prices always match enforced prices.

export const ROUTE_CATALOG = [
  {
    route: 'POST /v1/content/list',
    price: '$0.001',
    description: 'List DA documents at a given path',
    body: { org: 'string', repo: 'string', path: 'string?', env: 'string?' },
  },
  {
    route: 'POST /v1/content/get',
    price: '$0.001',
    description: 'Fetch a DA document',
    body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
  },
  {
    route: 'POST /v1/content/put',
    price: '$0.002',
    description: 'Write an HTML document to DA source',
    body: { org: 'string', repo: 'string', path: 'string', content: 'string (HTML)', env: 'string?' },
  },
  {
    route: 'POST /v1/preview',
    price: '$0.04',
    description: 'Trigger Helix preview cache flush for a page',
    body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
  },
  {
    route: 'POST /v1/publish',
    price: '$0.04',
    description: 'Promote a page to *.aem.live CDN',
    body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
  },
  {
    route: 'POST /v1/deploy',
    price: '$0.06',
    description: 'Preview + publish in one atomic step',
    body: { org: 'string', repo: 'string', path: 'string', env: 'string?' },
  },
  {
    route: 'POST /v1/stardust/extract',
    price: '$0.05',
    description: 'Stardust: extract brand context from a site URL',
    body: { org: 'string', repo: 'string', url: 'string?', env: 'string?' },
  },
  {
    route: 'POST /v1/stardust/direct',
    price: '$0.07',
    description: 'Stardust: produce a target design spec from an AI redesign intent',
    body: { org: 'string', repo: 'string', intent: 'string', palette: 'string?', env: 'string?' },
  },
  {
    route: 'POST /v1/stardust/migrate',
    price: '$0.05',
    description: 'Stardust: migrate content to the new design spec',
    body: { org: 'string', repo: 'string', source: 'string?', env: 'string?' },
  },
  {
    route: 'POST /v1/pipeline/run',
    price: '$0.25',
    description:
      'Execute a pipeline. Pass { pipeline: "name" } to run a named pipeline from ' +
      '~/.da/pipelines/, or { yaml: "..." } to submit a custom agent-authored YAML ' +
      'pipeline descriptor — the highest-value capability. Steps with requires_approval ' +
      'are rejected (no interactive stdin in the HTTP context).',
    body: {
      pipeline: 'string — named pipeline (mutually exclusive with yaml)',
      yaml: 'string — full YAML descriptor (mutually exclusive with pipeline)',
      org: 'string?', repo: 'string?', env: 'string?',
    },
  },
  {
    route: 'POST /v1/pipeline/custom',
    price: '$0.25',
    description: 'Alias for POST /v1/pipeline/run with { yaml }. Accepts { yaml } directly.',
    body: { yaml: 'string', org: 'string?', repo: 'string?', env: 'string?' },
    alias: true,
  },
];

// Derive x402-express middleware config object from the catalog.
export function toMiddlewareConfig(catalog, network) {
  return Object.fromEntries(
    catalog.map(({ route, price }) => [route, { price, network }])
  );
}

// Derive agent card endpoints map from the catalog.
export function toEndpointsMap(catalog) {
  return Object.fromEntries(
    catalog.map(({ route, price, description, body }) => [route, { price, description, body }])
  );
}
