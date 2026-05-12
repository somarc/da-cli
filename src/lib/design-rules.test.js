import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectAll, detectByCategory, summarize, CATEGORIES, SEVERITY } from './design-rules.js';

describe('design-rules — detectAll', () => {
  it('returns empty array for clean HTML', () => {
    const html = '<html><body><main><h1>Hello</h1><p>World</p></main></body></html>';
    const findings = detectAll(html);
    assert.equal(findings.length, 0);
  });

  it('detects gradient-text (background-clip:text)', () => {
    const html = '<style>.hero { background-clip: text; }</style>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'gradient-text'));
  });

  it('detects glassmorphism (backdrop-filter:blur)', () => {
    const html = '<style>.card { backdrop-filter: blur(10px); }</style>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'glassmorphism'));
  });

  it('detects missing-alt-text on img without alt', () => {
    const html = '<img src="photo.jpg">';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'missing-alt-text'));
  });

  it('does not flag img with alt attribute', () => {
    const html = '<img src="photo.jpg" alt="A photo">';
    const findings = detectAll(html);
    assert.ok(!findings.some((f) => f.rule === 'missing-alt-text'));
  });

  it('detects skipped-heading (h1 → h3)', () => {
    const html = '<h1>Title</h1><h3>Subhead</h3>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'skipped-heading'));
  });

  it('does not flag sequential headings (h1 → h2 → h3)', () => {
    const html = '<h1>A</h1><h2>B</h2><h3>C</h3>';
    const findings = detectAll(html);
    assert.ok(!findings.some((f) => f.rule === 'skipped-heading'));
  });

  it('detects generic-cta "Click here"', () => {
    const html = '<a href="/page">Click here</a>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'generic-cta'));
  });

  it('detects anchor-without-aria-label for icon-only link', () => {
    const html = '<a href="/home"><img src="icon.svg"></a>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'anchor-without-aria-label'));
  });

  it('does not flag anchor with aria-label', () => {
    const html = '<a href="/home" aria-label="Go home"><img src="icon.svg"></a>';
    const findings = detectAll(html);
    assert.ok(!findings.some((f) => f.rule === 'anchor-without-aria-label'));
  });

  it('detects overused-font (Inter)', () => {
    const html = '<style>body { font-family: "Inter"; }</style>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'overused-font'));
  });

  it('detects layout-transition', () => {
    const html = '<style>.box { transition: width 0.3s ease; }</style>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'layout-transition'));
  });

  it('detects tiny text (<12px)', () => {
    const html = '<style>small { font-size: 9px; }</style>';
    const findings = detectAll(html);
    assert.ok(findings.some((f) => f.rule === 'tiny-text'));
  });
});

describe('design-rules — detectByCategory', () => {
  it('filters to ai-slop category only', () => {
    const html = '<style>body { backdrop-filter: blur(5px); font-family: "Inter"; }</style>';
    const findings = detectByCategory(html, CATEGORIES.AI_SLOP);
    assert.ok(findings.every((f) => f.category === CATEGORIES.AI_SLOP));
    assert.ok(findings.some((f) => f.rule === 'overused-font'));
  });
});

describe('design-rules — summarize', () => {
  it('counts findings by severity', () => {
    const html = [
      '<style>body { backdrop-filter: blur(5px); background-clip: text; }</style>',
      '<img src="x.jpg">',
    ].join('\n');
    const findings = detectAll(html);
    const s = summarize(findings);
    assert.equal(typeof s.error, 'number');
    assert.equal(typeof s.warning, 'number');
    assert.equal(typeof s.info, 'number');
    assert.equal(s.total, findings.length);
    assert.ok(s.error > 0, 'expected at least one error finding');
  });

  it('returns unique rule IDs', () => {
    const html = '<style>body { backdrop-filter: blur(5px); }</style><img src="x.jpg"><img src="y.jpg">';
    const findings = detectAll(html);
    const s = summarize(findings);
    const unique = new Set(s.rules);
    assert.equal(unique.size, s.rules.length, 'rule IDs should be deduplicated');
  });
});
