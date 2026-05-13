import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTE_CATALOG, toMiddlewareConfig, toEndpointsMap } from './catalog.js';

test('ROUTE_CATALOG has at least one entry per tier', () => {
  const routes = ROUTE_CATALOG.map((e) => e.route);
  assert.ok(routes.some((r) => r.includes('/content/')));
  assert.ok(routes.some((r) => r.includes('/stardust/')));
  assert.ok(routes.some((r) => r.includes('/pipeline/')));
});

test('every catalog entry has route, price, description, body', () => {
  for (const entry of ROUTE_CATALOG) {
    assert.ok(entry.route, `missing route: ${JSON.stringify(entry)}`);
    assert.ok(entry.price, `missing price: ${entry.route}`);
    assert.ok(entry.description, `missing description: ${entry.route}`);
    assert.ok(entry.body, `missing body: ${entry.route}`);
  }
});

test('toMiddlewareConfig produces route → { price, network } map', () => {
  const config = toMiddlewareConfig(ROUTE_CATALOG, 'base');
  for (const { route, price } of ROUTE_CATALOG) {
    assert.ok(config[route], `missing route in middleware config: ${route}`);
    assert.equal(config[route].price, price);
    assert.equal(config[route].network, 'base');
  }
  assert.equal(Object.keys(config).length, ROUTE_CATALOG.length);
});

test('toEndpointsMap produces route → { price, description, body } map', () => {
  const map = toEndpointsMap(ROUTE_CATALOG);
  for (const { route, price, description } of ROUTE_CATALOG) {
    assert.equal(map[route].price, price);
    assert.equal(map[route].description, description);
  }
});

test('middleware config and endpoints map have identical route sets', () => {
  const middlewareRoutes = new Set(Object.keys(toMiddlewareConfig(ROUTE_CATALOG, 'base')));
  const endpointRoutes = new Set(Object.keys(toEndpointsMap(ROUTE_CATALOG)));
  assert.deepEqual(middlewareRoutes, endpointRoutes);
});

test('pipeline/run is the highest-priced route', () => {
  const parse = (s) => parseFloat(s.replace('$', ''));
  const pipelineEntry = ROUTE_CATALOG.find((e) => e.route === 'POST /v1/pipeline/run');
  const pipelinePrice = parse(pipelineEntry.price);
  for (const { route, price } of ROUTE_CATALOG) {
    assert.ok(
      pipelinePrice >= parse(price),
      `pipeline/run ($${pipelinePrice}) should be >= ${route} ($${parse(price)})`
    );
  }
});
