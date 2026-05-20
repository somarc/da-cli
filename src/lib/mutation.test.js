import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setGlobals } from './context.js';
import { enforceBulkWriteSafety } from './mutation.js';

describe('enforceBulkWriteSafety', () => {
  test('allows dry-run bulk writes', () => {
    setGlobals({ commit: false, dryRun: false, org: undefined, repo: undefined });
    assert.deepEqual(
      enforceBulkWriteSafety({ pathCount: 12, configSources: { org: 'project', repo: 'project' } }),
      { proceed: true },
    );
  });

  test('allows single-path committed writes from config', () => {
    setGlobals({ commit: true, dryRun: false, org: undefined, repo: undefined });
    assert.deepEqual(
      enforceBulkWriteSafety({ pathCount: 1, configSources: { org: 'project', repo: 'project' } }),
      { proceed: true },
    );
  });

  test('allows explicit committed bulk target', () => {
    setGlobals({ commit: true, dryRun: false, org: 'somarc', repo: 'chronicle' });
    assert.deepEqual(
      enforceBulkWriteSafety({ pathCount: 2, configSources: { org: 'flag', repo: 'flag' } }),
      { proceed: true },
    );
  });

  test('allows committed bulk write with yes', () => {
    setGlobals({ commit: true, dryRun: false, org: undefined, repo: undefined });
    assert.deepEqual(
      enforceBulkWriteSafety({ pathCount: 2, yes: true, configSources: { org: 'project', repo: 'project' } }),
      { proceed: true },
    );
  });

  test('blocks committed bulk write from implicit target', () => {
    setGlobals({ commit: true, dryRun: false, org: undefined, repo: undefined });
    const result = enforceBulkWriteSafety({
      pathCount: 2,
      configSources: { org: 'project', repo: 'project' },
      operation: 'deploy pages /',
    });
    assert.equal(result.proceed, false);
    assert.match(result.reason, /deploy pages \//);
    assert.match(result.reason, /explicit --org and --repo/);
  });
});
