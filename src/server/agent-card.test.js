import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCard } from './agent-card.js';

test('agentCard returns valid ERC-8004 structure', () => {
  const card = agentCard('http://localhost:3402');
  assert.equal(card.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1');
  assert.ok(typeof card.name === 'string' && card.name.length > 0);
  assert.ok(typeof card.description === 'string');
  assert.ok(card.x402Support === true);
  assert.ok(card.active === true);
  assert.ok(Array.isArray(card.services) && card.services.length > 0);
  assert.ok(card.endpoints && typeof card.endpoints === 'object');
});

test('custom pipeline is the highest-priced endpoint', () => {
  const card = agentCard('http://localhost:3402');
  const parse = (s) => parseFloat(s.replace('$', ''));
  const customPrice = parse(card.endpoints['POST /v1/pipeline/custom'].price);
  for (const [route, ep] of Object.entries(card.endpoints)) {
    assert.ok(
      customPrice >= parse(ep.price),
      `custom pipeline ($${customPrice}) should be >= ${route} ($${parse(ep.price)})`
    );
  }
});

test('named pipeline is cheaper than custom pipeline', () => {
  const card = agentCard('http://localhost:3402');
  const parse = (s) => parseFloat(s.replace('$', ''));
  assert.ok(
    parse(card.endpoints['POST /v1/pipeline/custom'].price) >
    parse(card.endpoints['POST /v1/pipeline/run'].price)
  );
});

test('service includes custom-yaml-pipeline-execution skill', () => {
  const card = agentCard('http://localhost:3402');
  const skills = card.services[0].skills;
  assert.ok(skills.includes('custom-yaml-pipeline-execution'));
});

test('baseUrl is reflected in service endpoint', () => {
  const card = agentCard('https://da-api.example.com');
  assert.equal(card.services[0].endpoint, 'https://da-api.example.com');
});
