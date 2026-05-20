import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  cloneWorkspace,
  commitWorkspace,
  pushWorkspace,
  stage,
  workspaceStatus,
} from './content-workspace.js';

let cwd;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), 'da-workspace-'));
  process.chdir(cwd);
});

afterEach(async () => {
  process.chdir(os.tmpdir());
  await rm(cwd, { recursive: true, force: true });
});

describe('content workspace', () => {
  test('clones remote DA source files into content/', async () => {
    const client = fakeClient({ '/index.html': '<main>Home</main>' });
    const result = await cloneWorkspace(client, { rootPath: '/' });

    assert.equal(result.files, 1);
    assert.equal(await readFile('content/index.html', 'utf8'), '<main>Home</main>');
    assert.deepEqual(await workspaceStatus(), []);
  });

  test('detects local modifications and stages them', async () => {
    const client = fakeClient({ '/index.html': '<main>Home</main>' });
    await cloneWorkspace(client, { rootPath: '/' });
    await writeFile('content/index.html', '<main>Changed</main>');

    assert.deepEqual(await workspaceStatus(), [{ status: 'modified', staged: '', path: '/index.html' }]);
    assert.deepEqual(await stage([]), ['/index.html']);
    assert.deepEqual(await workspaceStatus(), [{ status: 'modified', staged: 'yes', path: '/index.html' }]);
  });

  test('pushes committed changes and updates base state', async () => {
    const client = fakeClient({ '/index.html': '<main>Home</main>' });
    await cloneWorkspace(client, { rootPath: '/' });
    await writeFile('content/index.html', '<main>Changed</main>');
    await stage([]);
    await commitWorkspace('update index');

    const result = await pushWorkspace(client);
    assert.equal(result.pushed, 1);
    assert.equal(client.remote['/index.html'], '<main>Changed</main>');
    assert.deepEqual(await workspaceStatus(), []);
  });

  test('push dry-run returns a plan without writing', async () => {
    const client = fakeClient({ '/index.html': '<main>Home</main>' });
    await cloneWorkspace(client, { rootPath: '/' });
    await mkdir('content/blog', { recursive: true });
    await writeFile('content/blog/post.html', '<main>Post</main>');
    await stage([]);
    await commitWorkspace('add post');

    const result = await pushWorkspace(client, { dryRun: true });
    assert.deepEqual(result.planned, ['/blog/post.html']);
    assert.equal(client.remote['/blog/post.html'], undefined);
  });

  test('push requires a local commit unless forced', async () => {
    const client = fakeClient({ '/index.html': '<main>Home</main>' });
    await cloneWorkspace(client, { rootPath: '/' });
    await writeFile('content/index.html', '<main>Changed</main>');
    await stage([]);

    await assert.rejects(() => pushWorkspace(client), /uncommitted changes: \/index\.html/);
  });
});

function fakeClient(remote) {
  return {
    org: 'o',
    repo: 'r',
    remote,
    async list(prefix = '/') {
      const clean = prefix.replace(/\/$/, '') || '/';
      const children = new Map();
      for (const daPath of Object.keys(remote)) {
        if (clean !== '/' && !daPath.startsWith(`${clean}/`) && daPath !== clean) continue;
        const rest = clean === '/' ? daPath.slice(1) : daPath.slice(clean.length + 1);
        if (!rest) continue;
        const [first] = rest.split('/');
        if (!children.has(first)) {
          const isFile = !rest.includes('/');
          const parsed = path.parse(first);
          children.set(first, isFile
            ? { path: `/o/r${clean === '/' ? '' : clean}/${first}`, name: parsed.name, ext: parsed.ext.slice(1) }
            : { path: `/o/r${clean === '/' ? '' : clean}/${first}`, name: first });
        }
      }
      return [...children.values()];
    },
    async sourceGet(daPath) {
      return { async text() { return remote[daPath]; } };
    },
    async sourcePut(daPath, text) {
      remote[daPath] = text;
    },
    async sourceDelete(daPath) {
      delete remote[daPath];
    },
  };
}
