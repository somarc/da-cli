import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isEmptyContent } from './preview.js';

describe('isEmptyContent', () => {
  test('empty string is empty', () => {
    assert.equal(isEmptyContent(''), true);
  });

  test('whitespace-only string is empty', () => {
    assert.equal(isEmptyContent('   \n  '), true);
  });

  test('bare <div></div> is empty', () => {
    assert.equal(isEmptyContent('<div></div>'), true);
  });

  test('<div></div> with internal whitespace is empty', () => {
    assert.equal(isEmptyContent('<div>  </div>'), true);
    assert.equal(isEmptyContent('<div>\n</div>'), true);
  });

  test('surrounding whitespace does not affect detection', () => {
    assert.equal(isEmptyContent('  <div></div>  '), true);
  });

  test('<div> with real content is not empty', () => {
    assert.equal(isEmptyContent('<div><h1>Hello</h1></div>'), false);
  });

  test('plain HTML with sections is not empty', () => {
    const html = '<div>\n  <h1 id="title">Title</h1>\n  <p>Body text.</p>\n</div>';
    assert.equal(isEmptyContent(html), false);
  });

  test('multiple top-level divs is not empty', () => {
    assert.equal(isEmptyContent('<div><p>One</p></div><div><p>Two</p></div>'), false);
  });
});
