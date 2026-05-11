import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTarget } from './index.js';

// ── normalizeTarget ───────────────────────────────────────────────────────────

describe('normalizeTarget', () => {
  test('appends .json to extensionless target', () => {
    assert.equal(normalizeTarget('/query-index'), '/query-index.json');
  });

  test('does not double-append when target already ends with .json', () => {
    assert.equal(normalizeTarget('/query-index.json'), '/query-index.json');
  });

  test('appends .json to a custom path without extension', () => {
    assert.equal(normalizeTarget('/blog/index'), '/blog/index.json');
  });

  test('leaves /blog/index.json unchanged', () => {
    assert.equal(normalizeTarget('/blog/index.json'), '/blog/index.json');
  });

  test('default EDS target /query-index → /query-index.json', () => {
    assert.equal(normalizeTarget('/query-index'), '/query-index.json');
  });
});
