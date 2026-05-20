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

test('toMiddlewareConfig produces v2 route payment requirements', () => {
  const payTo = '0x0000000000000000000000000000000000000001';
  const config = toMiddlewareConfig(ROUTE_CATALOG, 'eip155:84532', payTo);
  for (const { route, price, description } of ROUTE_CATALOG) {
    assert.ok(config[route], `missing route in middleware config: ${route}`);
    assert.equal(config[route].accepts.scheme, 'exact');
    assert.equal(config[route].accepts.price, price);
    assert.equal(config[route].accepts.network, 'eip155:84532');
    assert.equal(config[route].accepts.payTo, payTo);
    assert.equal(config[route].description, description);
    assert.equal(config[route].mimeType, 'application/json');
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
  const middlewareRoutes = new Set(Object.keys(toMiddlewareConfig(
    ROUTE_CATALOG,
    'eip155:84532',
    '0x0000000000000000000000000000000000000001'
  )));
  const endpointRoutes = new Set(Object.keys(toEndpointsMap(ROUTE_CATALOG)));
  assert.deepEqual(middlewareRoutes, endpointRoutes);
});

test('pipeline/custom is the highest-priced route', () => {
  const parse = (s) => parseFloat(s.replace('$', ''));
  const customEntry = ROUTE_CATALOG.find((e) => e.route === 'POST /v1/pipeline/custom');
  const customPrice = parse(customEntry.price);
  for (const { route, price } of ROUTE_CATALOG) {
    assert.ok(
      customPrice >= parse(price),
      `pipeline/custom ($${customPrice}) should be >= ${route} ($${parse(price)})`
    );
  }
});

test('pipeline/custom is priced higher than pipeline/run', () => {
  const parse = (s) => parseFloat(s.replace('$', ''));
  const runEntry = ROUTE_CATALOG.find((e) => e.route === 'POST /v1/pipeline/run');
  const customEntry = ROUTE_CATALOG.find((e) => e.route === 'POST /v1/pipeline/custom');
  assert.ok(
    parse(customEntry.price) > parse(runEntry.price),
    `custom (${customEntry.price}) must exceed named run (${runEntry.price})`
  );
});
