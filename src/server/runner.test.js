import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlags } from './runner.js';

test('buildFlags always includes --commit and --format json', () => {
  const flags = buildFlags({});
  assert.ok(flags.includes('--commit'));
  assert.ok(flags.includes('--format'));
  assert.ok(flags.includes('json'));
});

test('buildFlags extracts org, repo, env from body', () => {
  const flags = buildFlags({ org: 'somarc', repo: 'da-cli', env: 'stage' });
  assert.ok(flags.includes('--org'));
  assert.equal(flags[flags.indexOf('--org') + 1], 'somarc');
  assert.ok(flags.includes('--repo'));
  assert.equal(flags[flags.indexOf('--repo') + 1], 'da-cli');
  assert.ok(flags.includes('--env'));
  assert.equal(flags[flags.indexOf('--env') + 1], 'stage');
});

test('buildFlags omits missing optional fields', () => {
  const flags = buildFlags({ org: 'somarc' });
  assert.ok(!flags.includes('--repo'));
  assert.ok(!flags.includes('--env'));
});

test('buildFlags does not mutate input body', () => {
  const body = { org: 'adobe', extra: 'ignored' };
  buildFlags(body);
  assert.deepEqual(body, { org: 'adobe', extra: 'ignored' });
});
