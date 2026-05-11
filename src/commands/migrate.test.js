import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  urlToPath,
  extractPageMetadata,
  absolutizeUrls,
  cleanHtml,
  convertBlocks,
  buildEdsDocument,
  extractTagContent,
} from './migrate.js';

// ── urlToPath ─────────────────────────────────────────────────────────────────

describe('urlToPath', () => {
  test('extracts pathname and adds .html', () => {
    assert.equal(urlToPath('https://old.com/products/widget'), '/products/widget.html');
  });

  test('root URL becomes /index.html', () => {
    assert.equal(urlToPath('https://old.com/'), '/index.html');
    // trailing slash stripped → '' → '/' → '/index' for root? Actually '/'.html
    // Let's just assert it starts with /
    assert.ok(urlToPath('https://old.com/').startsWith('/'));
  });

  test('keeps .html if already present', () => {
    assert.equal(urlToPath('https://old.com/page.html'), '/page.html');
  });

  test('handles deep paths', () => {
    assert.equal(urlToPath('https://old.com/en/blog/post'), '/en/blog/post.html');
  });

  test('invalid URL returns /imported.html', () => {
    assert.equal(urlToPath('not-a-url'), '/imported.html');
  });
});

// ── extractPageMetadata ───────────────────────────────────────────────────────

describe('extractPageMetadata', () => {
  test('extracts og:title and description', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="My Page Title">
        <meta name="description" content="A short description">
      </head></html>
    `;
    const meta = extractPageMetadata(html, 'https://old.com/page');
    assert.equal(meta.title, 'My Page Title');
    assert.equal(meta.description, 'A short description');
  });

  test('falls back to <title> when og:title absent', () => {
    const html = '<html><head><title>Fallback Title</title></head></html>';
    const meta = extractPageMetadata(html, 'https://old.com/page');
    assert.equal(meta.title, 'Fallback Title');
  });

  test('extracts og:image', () => {
    const html = '<meta property="og:image" content="https://old.com/img/hero.jpg">';
    const meta = extractPageMetadata(html, 'https://old.com/page');
    assert.equal(meta.image, 'https://old.com/img/hero.jpg');
  });

  test('falls back to sourceUrl for canonical when absent', () => {
    const meta = extractPageMetadata('<html></html>', 'https://old.com/page');
    assert.equal(meta.canonical, 'https://old.com/page');
  });

  test('prefers rel=canonical over sourceUrl', () => {
    const html = '<link rel="canonical" href="https://old.com/canonical-page">';
    const meta = extractPageMetadata(html, 'https://old.com/page');
    assert.equal(meta.canonical, 'https://old.com/canonical-page');
  });

  test('handles reversed attribute order (content before property)', () => {
    const html = '<meta content="Reversed Title" property="og:title">';
    const meta = extractPageMetadata(html, 'https://old.com/page');
    assert.equal(meta.title, 'Reversed Title');
  });
});

// ── absolutizeUrls ────────────────────────────────────────────────────────────

describe('absolutizeUrls', () => {
  test('makes relative src absolute', () => {
    const html = '<img src="/images/hero.jpg">';
    const result = absolutizeUrls(html, 'https://old.com/page');
    assert.ok(result.includes('src="https://old.com/images/hero.jpg"'));
  });

  test('makes relative href absolute', () => {
    const html = '<a href="/about">About</a>';
    const result = absolutizeUrls(html, 'https://old.com/page');
    assert.ok(result.includes('href="https://old.com/about"'));
  });

  test('leaves absolute URLs unchanged', () => {
    const html = '<img src="https://cdn.com/img.jpg">';
    const result = absolutizeUrls(html, 'https://old.com/page');
    assert.ok(result.includes('src="https://cdn.com/img.jpg"'));
  });

  test('leaves mailto: and tel: hrefs unchanged', () => {
    const html = '<a href="mailto:foo@bar.com">Email</a>';
    const result = absolutizeUrls(html, 'https://old.com/page');
    assert.ok(result.includes('href="mailto:foo@bar.com"'));
  });

  test('leaves anchor hrefs unchanged', () => {
    const html = '<a href="#section">Jump</a>';
    const result = absolutizeUrls(html, 'https://old.com/page');
    assert.ok(result.includes('href="#section"'));
  });
});

// ── cleanHtml ─────────────────────────────────────────────────────────────────

describe('cleanHtml', () => {
  test('removes <script> blocks', () => {
    const html = '<p>Hello</p><script>alert("x")</script><p>World</p>';
    assert.ok(!cleanHtml(html).includes('<script>'));
  });

  test('removes <style> blocks', () => {
    const html = '<style>.foo { color: red }</style><p>Content</p>';
    assert.ok(!cleanHtml(html).includes('<style>'));
  });

  test('removes HTML comments', () => {
    const html = '<!-- comment --><p>Content</p>';
    assert.ok(!cleanHtml(html).includes('<!--'));
  });

  test('strips class and id attributes from non-link/img tags', () => {
    const html = '<div class="container" id="main"><p class="intro">Text</p></div>';
    const result = cleanHtml(html);
    assert.ok(!result.includes('class="container"'));
    assert.ok(!result.includes('id="main"'));
  });

  test('preserves href on <a> tags', () => {
    const html = '<a href="https://example.com" class="link">Link</a>';
    const result = cleanHtml(html);
    assert.ok(result.includes('href="https://example.com"'));
  });

  test('preserves src and alt on <img> tags', () => {
    const html = '<img src="https://example.com/img.jpg" alt="Description" class="hero-img">';
    const result = cleanHtml(html);
    assert.ok(result.includes('src="https://example.com/img.jpg"'));
    assert.ok(result.includes('alt="Description"'));
    assert.ok(!result.includes('class="hero-img"'));
  });
});

// ── convertBlocks ─────────────────────────────────────────────────────────────

describe('convertBlocks', () => {
  test('converts iframe to embed block', () => {
    const html = '<iframe src="https://www.youtube.com/embed/abc123"></iframe>';
    const result = convertBlocks(html);
    assert.ok(result.includes('class="embed"'));
    assert.ok(result.includes('https://www.youtube.com/embed/abc123'));
  });

  test('first <figure> with image and caption becomes hero block', () => {
    const html = `
      <figure>
        <img src="https://old.com/img/hero.jpg">
        <figcaption>Hero caption</figcaption>
      </figure>
    `;
    const result = convertBlocks(html);
    assert.ok(result.includes('class="hero"'));
    assert.ok(result.includes('Hero caption'));
  });

  test('figure without caption: first becomes plain image', () => {
    const html = '<figure><img src="https://old.com/img.jpg"></figure>';
    const result = convertBlocks(html);
    assert.ok(!result.includes('class="hero"'));
    assert.ok(result.includes('<img src='));
  });

  test('subsequent figures do not become hero', () => {
    const html = `
      <figure><img src="https://old.com/hero.jpg"><figcaption>First</figcaption></figure>
      <figure><img src="https://old.com/other.jpg"><figcaption>Second</figcaption></figure>
    `;
    const result = convertBlocks(html);
    // Only one hero block
    const heroCount = (result.match(/class="hero"/g) ?? []).length;
    assert.equal(heroCount, 1);
  });

  test('figure with no img keeps inner content', () => {
    const html = '<figure><figcaption>Just a caption</figcaption></figure>';
    const result = convertBlocks(html);
    assert.ok(!result.includes('<figure>'));
    assert.ok(result.includes('Just a caption'));
  });
});

// ── buildEdsDocument ──────────────────────────────────────────────────────────

describe('buildEdsDocument', () => {
  test('wraps content in EDS skeleton', () => {
    const result = buildEdsDocument('<h1>Title</h1><p>Body</p>', {});
    assert.ok(result.includes('<body>'));
    assert.ok(result.includes('<header></header>'));
    assert.ok(result.includes('<main>'));
    assert.ok(result.includes('<footer></footer>'));
    assert.ok(result.includes('<h1>Title</h1>'));
  });

  test('generates metadata block when metadata present', () => {
    const result = buildEdsDocument('<p>Content</p>', {
      title: 'My Page',
      description: 'A description',
    });
    assert.ok(result.includes('class="metadata"'));
    assert.ok(result.includes('<div>title</div>'));
    assert.ok(result.includes('My Page'));
    assert.ok(result.includes('A description'));
  });

  test('omits metadata block when no metadata', () => {
    const result = buildEdsDocument('<p>Content</p>', {});
    assert.ok(!result.includes('class="metadata"'));
  });

  test('escapes special chars in metadata values', () => {
    const result = buildEdsDocument('<p>x</p>', { title: 'A & B <script>' });
    assert.ok(result.includes('A &amp; B &lt;script&gt;'));
    assert.ok(!result.includes('<script>'));
  });
});

// ── extractTagContent ─────────────────────────────────────────────────────────

describe('extractTagContent', () => {
  test('extracts <main> content', () => {
    const html = '<html><body><main><h1>Title</h1><p>Body</p></main></body></html>';
    const result = extractTagContent(html, 'main');
    assert.ok(result.includes('<h1>Title</h1>'));
    assert.ok(!result.includes('<body>'));
  });

  test('handles nested same-tag elements', () => {
    const html = '<div><div id="inner">nested</div></div>';
    const result = extractTagContent(html, 'div');
    assert.ok(result.includes('id="inner"'));
    assert.ok(result.includes('nested'));
  });

  test('returns null when tag not found', () => {
    assert.equal(extractTagContent('<p>No main here</p>', 'main'), null);
  });

  test('works with tag attributes', () => {
    const html = '<main class="content"><p>Inside</p></main>';
    const result = extractTagContent(html, 'main');
    assert.ok(result.includes('<p>Inside</p>'));
  });
});
