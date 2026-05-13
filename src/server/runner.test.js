import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlags, hasApprovalGates } from './runner.js';

// ── buildFlags ────────────────────────────────────────────────────────────────

test('buildFlags always includes --commit and --format json', () => {
  const flags = buildFlags({});
  assert.ok(flags.includes('--commit'));
  assert.ok(flags.includes('--format'));
  assert.ok(flags.includes('json'));
});

test('buildFlags extracts org, repo, env from body', () => {
  const flags = buildFlags({ org: 'somarc', repo: 'da-cli', env: 'stage' });
  assert.equal(flags[flags.indexOf('--org') + 1], 'somarc');
  assert.equal(flags[flags.indexOf('--repo') + 1], 'da-cli');
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

// ── hasApprovalGates ──────────────────────────────────────────────────────────

test('hasApprovalGates returns false for pipeline with no approval steps', () => {
  const yaml = `
pipeline:
  name: deploy
  steps:
    - id: preview
      command: preview page /index
    - id: publish
      command: publish page /index
      depends_on: [preview]
`;
  assert.equal(hasApprovalGates(yaml), false);
});

test('hasApprovalGates returns true when any step has requires_approval', () => {
  const yaml = `
pipeline:
  name: gated-deploy
  steps:
    - id: preview
      command: preview page /index
    - id: approval-gate
      command: publish page /index
      requires_approval: true
`;
  assert.equal(hasApprovalGates(yaml), true);
});

test('hasApprovalGates returns false for empty steps array', () => {
  const yaml = `pipeline:\n  name: empty\n  steps: []`;
  assert.equal(hasApprovalGates(yaml), false);
});

test('hasApprovalGates returns false for invalid YAML (does not throw)', () => {
  assert.equal(hasApprovalGates('{ this is not: yaml: at all !!!'), false);
});

test('hasApprovalGates handles top-level steps (no pipeline wrapper)', () => {
  const yaml = `
steps:
  - id: step1
    command: preview page /
    requires_approval: true
`;
  assert.equal(hasApprovalGates(yaml), true);
});
