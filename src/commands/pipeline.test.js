import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validatePipeline, topoSort, parseCommandString, parseTimeout } from './pipeline.js';

// ── validatePipeline ──────────────────────────────────────────────────────────

describe('validatePipeline', () => {
  test('accepts valid pipeline', () => {
    assert.doesNotThrow(() => validatePipeline([
      { id: 'a', command: 'content list /' },
      { id: 'b', command: 'preview page /home', depends_on: ['a'] },
    ]));
  });

  test('throws when step is missing id', () => {
    assert.throws(
      () => validatePipeline([{ command: 'content list /' }]),
      /missing an 'id'/,
    );
  });

  test('throws when step is missing command', () => {
    assert.throws(
      () => validatePipeline([{ id: 'a' }]),
      /missing a 'command'/,
    );
  });

  test('throws when depends_on references unknown step', () => {
    assert.throws(
      () => validatePipeline([{ id: 'a', command: 'x', depends_on: ['nonexistent'] }]),
      /unknown step "nonexistent"/,
    );
  });
});

// ── topoSort ──────────────────────────────────────────────────────────────────

describe('topoSort', () => {
  test('single step returns one batch', () => {
    const batches = topoSort([{ id: 'a', command: 'x' }]);
    assert.equal(batches.length, 1);
    assert.equal(batches[0][0].id, 'a');
  });

  test('linear chain returns steps in dependency order', () => {
    const steps = [
      { id: 'a', command: 'x' },
      { id: 'b', command: 'x', depends_on: ['a'] },
      { id: 'c', command: 'x', depends_on: ['b'] },
    ];
    const batches = topoSort(steps);
    // Each step in its own batch since each depends on the previous
    assert.equal(batches.length, 3);
    assert.equal(batches[0][0].id, 'a');
    assert.equal(batches[1][0].id, 'b');
    assert.equal(batches[2][0].id, 'c');
  });

  test('independent steps appear in the same batch', () => {
    const steps = [
      { id: 'a', command: 'x' },
      { id: 'b', command: 'x' },
      { id: 'c', command: 'x', depends_on: ['a', 'b'] },
    ];
    const batches = topoSort(steps);
    assert.equal(batches.length, 2);
    const firstIds = batches[0].map((s) => s.id).sort();
    assert.deepEqual(firstIds, ['a', 'b']);
    assert.equal(batches[1][0].id, 'c');
  });

  test('pipeline-spec example: import → (audit, preview) → publish → validate', () => {
    const steps = [
      { id: 'import',   command: 'migrate batch urls.txt' },
      { id: 'audit',    command: 'audit full /**', depends_on: ['import'] },
      { id: 'preview',  command: 'preview pages /**', depends_on: ['import'] },
      { id: 'publish',  command: 'publish pages /**', depends_on: ['audit', 'preview'] },
      { id: 'validate', command: 'migrate validate /**', depends_on: ['publish'] },
    ];
    const batches = topoSort(steps);
    assert.equal(batches[0][0].id, 'import');
    const batch1Ids = batches[1].map((s) => s.id).sort();
    assert.deepEqual(batch1Ids, ['audit', 'preview']);
    assert.equal(batches[2][0].id, 'publish');
    assert.equal(batches[3][0].id, 'validate');
  });

  test('throws on dependency cycle', () => {
    const steps = [
      { id: 'a', command: 'x', depends_on: ['b'] },
      { id: 'b', command: 'x', depends_on: ['a'] },
    ];
    assert.throws(() => topoSort(steps), /cycle/);
  });

  test('all steps placed even without depends_on', () => {
    const steps = [
      { id: 'a', command: 'x' },
      { id: 'b', command: 'x' },
      { id: 'c', command: 'x' },
    ];
    const batches = topoSort(steps);
    assert.equal(batches.flat().length, 3);
  });
});

// ── parseCommandString ────────────────────────────────────────────────────────

describe('parseCommandString', () => {
  test('splits simple command', () => {
    assert.deepEqual(parseCommandString('migrate batch urls.txt'), ['migrate', 'batch', 'urls.txt']);
  });

  test('handles quoted strings', () => {
    assert.deepEqual(
      parseCommandString('content put /page "my file.html"'),
      ['content', 'put', '/page', 'my file.html'],
    );
  });

  test('handles flags', () => {
    assert.deepEqual(
      parseCommandString('preview pages /** --concurrency 10'),
      ['preview', 'pages', '/**', '--concurrency', '10'],
    );
  });

  test('handles single-quoted strings', () => {
    assert.deepEqual(
      parseCommandString("content get '/path with spaces'"),
      ['content', 'get', '/path with spaces'],
    );
  });

  test('empty string returns empty array', () => {
    assert.deepEqual(parseCommandString(''), []);
  });
});

// ── parseTimeout ──────────────────────────────────────────────────────────────

describe('parseTimeout', () => {
  test('parses seconds', () => {
    assert.equal(parseTimeout('30s'), 30_000);
  });

  test('parses minutes', () => {
    assert.equal(parseTimeout('5m'), 300_000);
  });

  test('parses hours', () => {
    assert.equal(parseTimeout('1h'), 3_600_000);
  });

  test('returns null for null/undefined input', () => {
    assert.equal(parseTimeout(null), null);
    assert.equal(parseTimeout(undefined), null);
  });

  test('returns null for invalid format', () => {
    assert.equal(parseTimeout('30'), null);
    assert.equal(parseTimeout('abc'), null);
  });
});
