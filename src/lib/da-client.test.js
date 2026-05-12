import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlainHtmlUrl } from './da-client.js';

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

  it('handles root path', () => {
    const url = buildPlainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/');
    assert.ok(url.endsWith('/.plain.html'), `got: ${url}`);
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
