import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCard } from './agent-card.js';
import { ROUTE_CATALOG } from './catalog.js';

const BASE = 'http://localhost:3402';
const OPTS = { version: '0.2.0', paymentEnabled: true };

test('agentCard returns valid ERC-8004 structure', () => {
  const card = agentCard(BASE, OPTS);
  assert.equal(card.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
  assert.ok(typeof card.name === 'string' && card.name.length > 0);
  assert.ok(typeof card.description === 'string');
  assert.ok(Array.isArray(card.services) && card.services.length > 0);
  assert.ok(card.endpoints && typeof card.endpoints === 'object');
});

test('x402Support reflects paymentEnabled param', () => {
  assert.equal(agentCard(BASE, { paymentEnabled: true }).x402Support, true);
  assert.equal(agentCard(BASE, { paymentEnabled: false }).x402Support, false);
  assert.equal(agentCard(BASE).x402Support, true, 'defaults to true');
});

test('version is reflected in service endpoint', () => {
  const card = agentCard(BASE, { version: '1.2.3' });
  assert.equal(card.services[0].version, '1.2.3');
});

test('baseUrl is reflected in service endpoint', () => {
  const card = agentCard('https://da-api.example.com', OPTS);
  assert.equal(card.services[0].endpoint, 'https://da-api.example.com');
});

test('agent card endpoints match catalog exactly', () => {
  const card = agentCard(BASE, OPTS);
  for (const { route, price } of ROUTE_CATALOG) {
    assert.ok(card.endpoints[route], `missing endpoint: ${route}`);
    assert.equal(card.endpoints[route].price, price, `price mismatch for ${route}`);
  }
  assert.equal(Object.keys(card.endpoints).length, ROUTE_CATALOG.length);
});

test('pipeline endpoints are the highest-priced tier', () => {
  const card = agentCard(BASE, OPTS);
  const parse = (s) => parseFloat(s.replace('$', ''));
  const pipelinePrice = parse(card.endpoints['POST /v1/pipeline/run'].price);
  for (const [route, ep] of Object.entries(card.endpoints)) {
    assert.ok(
      pipelinePrice >= parse(ep.price),
      `pipeline ($${pipelinePrice}) should be >= ${route} ($${parse(ep.price)})`
    );
  }
});

test('service includes custom-yaml-pipeline-execution skill', () => {
  const card = agentCard(BASE, OPTS);
  assert.ok(card.services[0].skills.includes('custom-yaml-pipeline-execution'));
});
