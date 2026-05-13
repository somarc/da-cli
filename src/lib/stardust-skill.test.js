import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from './stardust-skill.js';

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
    assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  });

  test('older local returns -1', () => {
    assert.equal(compareVersions('0.1.0', '0.3.0'), -1);
    assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
    assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  });

  test('newer local returns 1', () => {
    assert.equal(compareVersions('0.3.0', '0.1.0'), 1);
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  });

  test('handles missing patch segment', () => {
    assert.equal(compareVersions('0.3', '0.3.0'), 0);
    assert.equal(compareVersions('1.0', '0.9.9'), 1);
  });

  test('handles null/undefined gracefully', () => {
    assert.equal(compareVersions(null, '0.3.0'), -1);
    assert.equal(compareVersions('0.3.0', null), 1);
    assert.equal(compareVersions(null, null), 0);
  });
});
