import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveUrl,
  buildPlainHtmlUrl,
  buildPreviewUrl,
  canonicalWebPath,
  DaClient,
} from './da-client.js';

describe('buildPlainHtmlUrl — production URL construction', () => {
  it('uses the configured branch, not hardcoded main', () => {
    const url = buildPlainHtmlUrl({ org: 'myorg', repo: 'myrepo', branch: 'feature-1' }, '/my-page');
    assert.ok(url.startsWith('https://feature-1--myrepo--myorg.aem.page'), `got: ${url}`);
  });

  it('defaults to main when branch is omitted', () => {
    const url = buildPlainHtmlUrl({ org: 'myorg', repo: 'myrepo' }, '/my-page');
    assert.ok(url.startsWith('https://main--myrepo--myorg.aem.page'), `got: ${url}`);
  });

  it('strips .html extension before appending .plain.html', () => {
    const url = buildPlainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/page.html');
    assert.ok(url.endsWith('/page.plain.html'), `got: ${url}`);
  });

  it('handles extensionless paths', () => {
    const url = buildPlainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/page');
    assert.ok(url.endsWith('/page.plain.html'), `got: ${url}`);
  });

  it('handles root path — maps / to /index.plain.html', () => {
    // EDS serves the root page at /index.plain.html, not /.plain.html.
    // site info health probe passes '/' and must get a resolvable URL.
    const url = buildPlainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/');
    assert.ok(url.endsWith('/index.plain.html'), `got: ${url}`);
  });

  it('is a pure function — no side effects, no auth token required', () => {
    const url1 = buildPlainHtmlUrl({ org: 'o', repo: 'r', branch: 'b' }, '/test');
    const url2 = buildPlainHtmlUrl({ org: 'o', repo: 'r', branch: 'b' }, '/test');
    assert.equal(url1, url2);
  });

  it('encodes the full URL correctly', () => {
    const url = buildPlainHtmlUrl({ org: 'adobe', repo: 'da-cli', branch: 'main' }, '/docs/intro');
    assert.equal(url, 'https://main--da-cli--adobe.aem.page/docs/intro.plain.html');
  });
});

describe('canonical web URL construction', () => {
  it('maps /index.html to the root URL', () => {
    assert.equal(canonicalWebPath('/index.html'), '/');
    assert.equal(buildPreviewUrl({ org: 'o', repo: 'r' }, '/index.html'), 'https://main--r--o.aem.page/');
  });

  it('maps folder index documents to trailing slash URLs', () => {
    assert.equal(canonicalWebPath('/crisis/index.html'), '/crisis/');
    assert.equal(buildLiveUrl({ org: 'o', repo: 'r' }, '/crisis/index.html'), 'https://main--r--o.aem.live/crisis/');
  });

  it('keeps non-index pages extensionless', () => {
    assert.equal(canonicalWebPath('/crisis/check.html'), '/crisis/check');
  });
});

describe('DaClient auth-optional diagnostics', () => {
  it('can carry auth errors for diagnostic callers', async () => {
    const authError = new Error('token refresh failed');
    const client = new DaClient({ org: 'o', repo: 'r', authError });

    assert.equal(client.authError, authError);
    await assert.rejects(
      () => client.sourceGet('/index.html'),
      /token refresh failed/,
    );
  });
});
