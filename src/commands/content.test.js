import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fragmentDiagnostic,
  isBinaryUpload,
  mimeTypeForUpload,
  normalizeHtmlPath,
} from './content.js';

describe('normalizeHtmlPath', () => {
  test('appends .html when path has no extension and local file is .html', () => {
    assert.equal(normalizeHtmlPath('/index', 'index.html'), '/index.html');
    assert.equal(normalizeHtmlPath('/lenses/runtime-topology', 'runtime-topology.html'), '/lenses/runtime-topology.html');
    assert.equal(normalizeHtmlPath('/nav', 'nav.html'), '/nav.html');
  });

  test('appends .html when path has no extension and no local file provided (get case)', () => {
    assert.equal(normalizeHtmlPath('/index'), '/index.html');
    assert.equal(normalizeHtmlPath('/nav'), '/nav.html');
  });

  test('leaves path alone when it already has .html extension', () => {
    assert.equal(normalizeHtmlPath('/index.html', 'index.html'), '/index.html');
  });

  test('leaves path alone when local file is not HTML', () => {
    assert.equal(normalizeHtmlPath('/config', 'config.json'), '/config');
    assert.equal(normalizeHtmlPath('/styles', 'styles.css'), '/styles');
  });

  test('leaves path alone when it has any other extension', () => {
    assert.equal(normalizeHtmlPath('/data.json'), '/data.json');
    assert.equal(normalizeHtmlPath('/image.png', 'image.png'), '/image.png');
  });

  test('handles root path — maps to /index.html', () => {
    assert.equal(normalizeHtmlPath('/'), '/index.html');
  });
});

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

describe('upload content type detection', () => {
  test('treats known media and binary asset extensions as binary uploads', () => {
    assert.equal(isBinaryUpload('hero.png'), true);
    assert.equal(isBinaryUpload('clip.MP4'), true);
    assert.equal(isBinaryUpload('font.woff2'), true);
    assert.equal(isBinaryUpload('document.pdf'), true);
  });

  test('uses expected MIME types for binary uploads', () => {
    assert.equal(mimeTypeForUpload('hero.png'), 'image/png');
    assert.equal(mimeTypeForUpload('photo.jpeg'), 'image/jpeg');
    assert.equal(mimeTypeForUpload('clip.mp4'), 'video/mp4');
    assert.equal(mimeTypeForUpload('font.woff2'), 'font/woff2');
  });

  test('defaults text-like uploads to text/html', () => {
    assert.equal(isBinaryUpload('index.html'), false);
    assert.equal(isBinaryUpload('metadata.json'), false);
    assert.equal(mimeTypeForUpload('index.html'), 'text/html');
    assert.equal(mimeTypeForUpload('metadata.json'), 'text/html');
  });
});
