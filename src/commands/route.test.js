import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify, listAllPaths } from './route.js';
import { DaApiError } from '../lib/da-client.js';

// ── classify ──────────────────────────────────────────────────────────────────

function makeClient({ sourceStatus = 200, helixSourceLocation = '', helixPreviewStatus = 200, helixLiveStatus = 200 } = {}) {
  return {
    org: 'testorg',
    repo: 'testrepo',
    async sourceGet(path) {
      if (sourceStatus === 404) throw new DaApiError(404, `/source/testorg/testrepo${path}`, 'not found');
      if (sourceStatus !== 200) throw new DaApiError(sourceStatus, `/source/testorg/testrepo${path}`, 'error');
    },
    async helixPreviewStatus(path) {
      if (helixSourceLocation === '__throw__') throw new Error('network timeout');
      return {
        preview: { sourceLocation: helixSourceLocation, status: helixPreviewStatus },
        live: { sourceLocation: helixSourceLocation, status: helixLiveStatus },
      };
    },
  };
}

describe('classify — ownership', () => {
  test('contentbus: DA source exists, DA sourceLocation', async () => {
    const client = makeClient({ helixSourceLocation: 'https://content.da.live/testorg/testrepo/page.html' });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'contentbus');
    assert.equal(result.daSource, true);
  });

  test('contentbus: DA source exists even if helix has no sourceLocation', async () => {
    const client = makeClient({ sourceStatus: 200, helixSourceLocation: '' });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'contentbus');
  });

  test('codebus: no DA source, GitHub sourceLocation', async () => {
    const client = makeClient({
      sourceStatus: 404,
      helixSourceLocation: 'https://raw.githubusercontent.com/testorg/testrepo/main/page.html',
    });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'codebus');
    assert.equal(result.daSource, false);
  });

  test('hybrid: DA source exists AND GitHub sourceLocation', async () => {
    const client = makeClient({
      sourceStatus: 200,
      helixSourceLocation: 'https://raw.githubusercontent.com/testorg/testrepo/main/page.html',
    });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'hybrid');
  });

  test('orphan: no DA source, no helix sourceLocation', async () => {
    const client = makeClient({ sourceStatus: 404, helixSourceLocation: '' });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'orphan');
  });
});

describe('classify — probe failures', () => {
  test('helix probe failure → probe-failed (not orphan)', async () => {
    const client = makeClient({ sourceStatus: 200, helixSourceLocation: '__throw__' });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'probe-failed');
    assert.ok(result.probeErrors.length > 0);
    assert.ok(result.probeErrors[0].startsWith('helix-status:'));
  });

  test('source probe 500 error → probe-failed (not contentbus/orphan)', async () => {
    const client = makeClient({ sourceStatus: 500 });
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'probe-failed');
    assert.ok(result.probeErrors.some((e) => e.startsWith('source:')));
  });

  test('both probes fail → probe-failed with two errors', async () => {
    const client = {
      org: 'testorg',
      repo: 'testrepo',
      async sourceGet() { throw new DaApiError(503, '/source', 'unavailable'); },
      async helixPreviewStatus() { throw new Error('connection refused'); },
    };
    const result = await classify(client, '/page');
    assert.equal(result.ownership, 'probe-failed');
    assert.equal(result.probeErrors.length, 2);
  });

  test('source 404 is not a probe failure — absence is valid signal', async () => {
    const client = makeClient({ sourceStatus: 404, helixSourceLocation: '' });
    const result = await classify(client, '/page');
    assert.notEqual(result.ownership, 'probe-failed');
  });
});

describe('classify — exit-code table', () => {
  const EXIT_CODES = { contentbus: 0, orphan: 2, codebus: 3, hybrid: 4, 'probe-failed': 5 };

  for (const [ownership, expectedCode] of Object.entries(EXIT_CODES)) {
    test(`${ownership} maps to exit code ${expectedCode}`, () => {
      const code = EXIT_CODES[ownership] ?? 1;
      assert.equal(code, expectedCode);
    });
  }

  test('unknown ownership falls back to exit code 1', () => {
    const EXIT = { contentbus: 0, orphan: 2, codebus: 3, hybrid: 4, 'probe-failed': 5 };
    assert.equal(EXIT['unknown-future-state'] ?? 1, 1);
  });
});

// ── listAllPaths ──────────────────────────────────────────────────────────────

function makeListClient(tree) {
  // tree: { '/': [{path, name, ext?}, ...], '/products': [...] }
  return {
    org: 'testorg',
    repo: 'testrepo',
    async list(prefix) {
      return tree[prefix] ?? [];
    },
  };
}

describe('listAllPaths — recursion', () => {
  test('flat list with no subdirectories', async () => {
    const client = makeListClient({
      '/docs': [
        { path: '/testorg/testrepo/docs/index.html', name: 'index', ext: 'html' },
        { path: '/testorg/testrepo/docs/about.html', name: 'about', ext: 'html' },
      ],
    });
    const paths = await listAllPaths(client, '/docs');
    assert.deepEqual(paths.sort(), ['/docs/about.html', '/docs/index.html']);
  });

  test('recurses into subdirectories', async () => {
    const client = makeListClient({
      '/docs': [
        { path: '/testorg/testrepo/docs/index.html', name: 'index', ext: 'html' },
        { path: '/testorg/testrepo/docs/products', name: 'products' }, // directory — no ext
      ],
      '/docs/products': [
        { path: '/testorg/testrepo/docs/products/a.html', name: 'a', ext: 'html' },
        { path: '/testorg/testrepo/docs/products/b.html', name: 'b', ext: 'html' },
      ],
    });
    const paths = await listAllPaths(client, '/docs');
    assert.deepEqual(paths.sort(), [
      '/docs/index.html',
      '/docs/products/a.html',
      '/docs/products/b.html',
    ]);
  });

  test('two levels deep', async () => {
    const client = makeListClient({
      '/': [
        { path: '/testorg/testrepo/en', name: 'en' },
      ],
      '/en': [
        { path: '/testorg/testrepo/en/blog', name: 'blog' },
      ],
      '/en/blog': [
        { path: '/testorg/testrepo/en/blog/post.html', name: 'post', ext: 'html' },
      ],
    });
    const paths = await listAllPaths(client, '/');
    assert.deepEqual(paths, ['/en/blog/post.html']);
  });

  test('empty directory returns empty list', async () => {
    const client = makeListClient({ '/empty': [] });
    const paths = await listAllPaths(client, '/empty');
    assert.deepEqual(paths, []);
  });

  test('trailing slash on prefix is stripped before first list call', async () => {
    const client = makeListClient({
      '/docs': [
        { path: '/testorg/testrepo/docs/index.html', name: 'index', ext: 'html' },
      ],
    });
    const paths = await listAllPaths(client, '/docs/');
    assert.deepEqual(paths, ['/docs/index.html']);
  });
});
