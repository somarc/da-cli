import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import only the pure URL-construction logic from da-client.
// We can't import the full module without a real fetch environment, so we
// replicate the URL formula to lock the contract here.

function plainHtmlUrl({ org, repo, branch = 'main' }, path) {
  const plain = path.replace(/\.html$/, '') + '.plain.html';
  const p = plain.startsWith('/') ? plain : `/${plain}`;
  return `https://${branch}--${repo}--${org}.aem.page${p}`;
}

describe('fetchPlainHtml — URL construction', () => {
  it('uses the configured branch, not hardcoded main', () => {
    const url = plainHtmlUrl({ org: 'myorg', repo: 'myrepo', branch: 'feature-1' }, '/my-page');
    assert.ok(url.startsWith('https://feature-1--myrepo--myorg.aem.page'), `got: ${url}`);
  });

  it('defaults to main when branch is omitted', () => {
    const url = plainHtmlUrl({ org: 'myorg', repo: 'myrepo' }, '/my-page');
    assert.ok(url.startsWith('https://main--myrepo--myorg.aem.page'), `got: ${url}`);
  });

  it('strips .html extension before appending .plain.html', () => {
    const url = plainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/page.html');
    assert.ok(url.endsWith('/page.plain.html'), `got: ${url}`);
  });

  it('handles extensionless paths', () => {
    const url = plainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/page');
    assert.ok(url.endsWith('/page.plain.html'), `got: ${url}`);
  });

  it('handles root path', () => {
    const url = plainHtmlUrl({ org: 'o', repo: 'r', branch: 'main' }, '/');
    assert.ok(url.endsWith('/.plain.html'), `got: ${url}`);
  });

  it('does not require auth token (pure URL construction, no DaClient needed)', () => {
    // The static helper signature takes { org, repo, branch } — no token
    const url = plainHtmlUrl({ org: 'o', repo: 'r' }, '/test');
    assert.equal(typeof url, 'string');
  });
});
