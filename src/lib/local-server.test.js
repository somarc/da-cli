import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildFallbackBaseUrl,
  resolveContentFile,
  resolveLocalFile,
} from './local-server.js';

describe('local server path resolution', () => {
  test('resolves extensionless routes to local HTML files first', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'da-up-'));
    try {
      await mkdir(path.join(dir, 'tools'), { recursive: true });
      await writeFile(path.join(dir, 'tools', 'flow.html'), '<main>Flow</main>');

      const resolved = await resolveLocalFile(dir, '/tools/flow');
      assert.equal(resolved.type, 'local');
      assert.equal(resolved.path, path.join(dir, 'tools', 'flow.html'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('resolves root route to index.html', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'da-up-'));
    try {
      await writeFile(path.join(dir, 'index.html'), '<main>Home</main>');
      const resolved = await resolveLocalFile(dir, '/');
      assert.equal(resolved.path, path.join(dir, 'index.html'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('resolves content workspace HTML for extensionless routes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'da-up-content-'));
    try {
      await mkdir(path.join(dir, 'blog'), { recursive: true });
      await writeFile(path.join(dir, 'blog', 'post.html'), '<main>Post</main>');

      const resolved = await resolveContentFile(dir, '/blog/post');
      assert.equal(resolved.type, 'content');
      assert.equal(resolved.path, path.join(dir, 'blog', 'post.html'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects traversal outside the served root', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'da-up-'));
    try {
      await assert.rejects(() => resolveLocalFile(dir, '/../secret.txt'), /path escapes server root/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('buildFallbackBaseUrl', () => {
  test('builds preview and live fallback origins', () => {
    assert.equal(
      buildFallbackBaseUrl({ org: 'somarc', repo: 'site', branch: 'main', fallback: 'preview' }),
      'https://main--site--somarc.aem.page',
    );
    assert.equal(
      buildFallbackBaseUrl({ org: 'somarc', repo: 'site', branch: 'main', fallback: 'live' }),
      'https://main--site--somarc.aem.live',
    );
  });

  test('returns null when fallback is disabled or config is incomplete', () => {
    assert.equal(buildFallbackBaseUrl({ org: 'somarc', repo: 'site', fallback: 'none' }), null);
    assert.equal(buildFallbackBaseUrl({ org: 'somarc', fallback: 'preview' }), null);
  });
});
