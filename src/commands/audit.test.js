import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractBlockDetails, extractBlockNames } from './audit.js';

// ── extractBlockNames ─────────────────────────────────────────────────────────

describe('extractBlockNames', () => {
  test('finds a single block', () => {
    const html = '<div class="hero"><div><div>Title</div></div></div>';
    assert.deepEqual([...extractBlockNames(html)], ['hero']);
  });

  test('finds multiple blocks', () => {
    const html = `
      <div class="hero"><div><div>T</div></div></div>
      <div class="columns"><div><div>A</div><div>B</div></div></div>
      <div class="cards"><div><div>C</div></div></div>
    `;
    const names = extractBlockNames(html);
    assert.ok(names.has('hero'));
    assert.ok(names.has('columns'));
    assert.ok(names.has('cards'));
  });

  test('skips metadata', () => {
    const html = '<div class="metadata"><div><div>Title</div><div>My Page</div></div></div>';
    assert.deepEqual([...extractBlockNames(html)], []);
  });

  test('skips section-metadata', () => {
    const html = '<div class="section-metadata"><div><div>style</div><div>dark</div></div></div>';
    assert.deepEqual([...extractBlockNames(html)], []);
  });

  test('finds decorated variant classes (primary name only)', () => {
    const html = '<div class="columns columns-3-col"><div><div>A</div></div></div>';
    const names = extractBlockNames(html);
    assert.ok(names.has('columns'));
  });

  test('does not match <divider> or other elements', () => {
    const html = '<divider></divider><div class="hero"><div><div>T</div></div></div>';
    const names = extractBlockNames(html);
    assert.deepEqual([...names], ['hero']);
  });
});

// ── extractBlockDetails ───────────────────────────────────────────────────────

describe('extractBlockDetails', () => {
  test('single-row single-col block', () => {
    const html = '<div class="banner"><div><div>Content</div></div></div>';
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, 'banner');
    assert.equal(blocks[0].rows, 1);
    assert.equal(blocks[0].cols, 1);
  });

  test('two-row two-col hero', () => {
    const html = `
      <div class="hero">
        <div>
          <div><h1>Title</h1></div>
          <div><p>Subtitle</p></div>
        </div>
        <div>
          <div><p>Second row</p></div>
          <div><p>Cell 2</p></div>
        </div>
      </div>
    `;
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, 'hero');
    assert.equal(blocks[0].rows, 2);
    assert.equal(blocks[0].cols, 2);
  });

  test('columns block (previously hard-skipped) is now included', () => {
    const html = `
      <div class="columns">
        <div>
          <div>A</div><div>B</div><div>C</div>
        </div>
      </div>
    `;
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, 'columns');
    assert.equal(blocks[0].rows, 1);
    assert.equal(blocks[0].cols, 3);
  });

  test('cards block (previously hard-skipped) is now included', () => {
    const html = `
      <div class="cards">
        <div><div>Card 1</div></div>
        <div><div>Card 2</div></div>
      </div>
    `;
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, 'cards');
    assert.equal(blocks[0].rows, 2);
    assert.equal(blocks[0].cols, 1);
  });

  test('skips metadata and section-metadata', () => {
    const html = `
      <div class="metadata"><div><div>Title</div><div>My Page</div></div></div>
      <div class="section-metadata"><div><div>style</div><div>dark</div></div></div>
    `;
    assert.deepEqual(extractBlockDetails(html), []);
  });

  test('multiple blocks in a page', () => {
    const html = `
      <div class="hero">
        <div><div>Title</div></div>
      </div>
      <div class="columns">
        <div><div>A</div><div>B</div></div>
        <div><div>C</div><div>D</div></div>
      </div>
    `;
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].name, 'hero');
    assert.equal(blocks[1].name, 'columns');
    assert.equal(blocks[1].rows, 2);
    assert.equal(blocks[1].cols, 2);
  });

  test('block with deeply nested cell content does not inflate row count', () => {
    // A single-row block whose cell has nested divs inside
    const html = `
      <div class="embed">
        <div>
          <div>
            <div class="nested-wrapper">
              <div>inner a</div>
              <div>inner b</div>
            </div>
          </div>
        </div>
      </div>
    `;
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].name, 'embed');
    assert.equal(blocks[0].rows, 1);
    assert.equal(blocks[0].cols, 1);
  });

  test('empty block body yields 0 rows', () => {
    const html = '<div class="spacer"></div>';
    const blocks = extractBlockDetails(html);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].rows, 0);
    assert.equal(blocks[0].cols, 0);
  });
});
