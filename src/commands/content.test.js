import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fragmentDiagnostic } from './content.js';

describe('fragmentDiagnostic', () => {
  test('returns null for non-HTML paths', () => {
    assert.equal(fragmentDiagnostic('<h1>Hello</h1>', '/page.md'), null);
    assert.equal(fragmentDiagnostic('<h1>Hello</h1>', '/page.json'), null);
    assert.equal(fragmentDiagnostic('<h1>Hello</h1>', '/page'), null);
  });

  test('returns null when <main> is present', () => {
    assert.equal(fragmentDiagnostic('<body><main><h1>Hi</h1></main></body>', '/page.html'), null);
  });

  test('returns null when <main> has attributes', () => {
    assert.equal(fragmentDiagnostic('<main class="content"><p>Hi</p></main>', '/page.html'), null);
  });

  test('flags fragment missing both <body> and <main>', () => {
    const result = fragmentDiagnostic('<h1>Hello</h1><p>World</p>', '/page.html');
    assert.ok(result);
    assert.equal(result.missingBody, true);
  });

  test('flags document with <body> but no <main>', () => {
    const result = fragmentDiagnostic('<body><h1>Hello</h1></body>', '/page.html');
    assert.ok(result);
    assert.equal(result.missingBody, false);
  });

  test('is case-insensitive on path extension', () => {
    const result = fragmentDiagnostic('<h1>Hello</h1>', '/page.HTML');
    assert.ok(result);
  });

  test('returns null for .htm extension with <main>', () => {
    assert.equal(fragmentDiagnostic('<main><p>ok</p></main>', '/page.htm'), null);
  });

  test('flags .htm fragment missing <main>', () => {
    const result = fragmentDiagnostic('<h1>Hello</h1>', '/page.htm');
    assert.ok(result);
    assert.equal(result.missingBody, true);
  });
});
