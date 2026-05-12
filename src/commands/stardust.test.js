import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshState,
  setPageMigrated,
  finalizeGlobalState,
} from '../lib/stardust-state.js';

describe('stardust migrate — state advancement (production helpers)', () => {
  it('does not advance page state when push fails', () => {
    const state = freshState();
    state.pages = [{ path: '/index', status: 'directed' }];
    // push failed — do not call setPageMigrated
    assert.equal(state.pages[0].status, 'directed');
    const count = finalizeGlobalState(state);
    assert.equal(count, 0);
    assert.equal(state.phase, 'fresh');
  });

  it('setPageMigrated advances a single page', () => {
    const state = freshState();
    state.pages = [{ path: '/index', status: 'directed' }];
    setPageMigrated(state, '/index');
    assert.equal(state.pages[0].status, 'migrated');
  });

  it('finalizeGlobalState does not set phase when zero pages migrated', () => {
    const state = { phase: 'directed', pages: [{ path: '/index', status: 'directed' }] };
    const count = finalizeGlobalState(state);
    assert.equal(count, 0);
    assert.equal(state.phase, 'directed');
    assert.equal(state.migratedAt, undefined);
  });

  it('finalizeGlobalState sets phase=migrated when at least one page succeeded', () => {
    const state = freshState();
    state.pages = [{ path: '/index', status: 'migrated' }];
    const count = finalizeGlobalState(state);
    assert.equal(count, 1);
    assert.equal(state.phase, 'migrated');
    assert.ok(state.migratedAt);
  });

  it('mixed success/failure batch: only successful pages advance', () => {
    const state = freshState();
    state.pages = [
      { path: '/index', status: 'directed' },
      { path: '/about', status: 'directed' },
    ];

    setPageMigrated(state, '/index');  // success
    // /about push failed — setPageMigrated NOT called for it

    assert.equal(state.pages.find((p) => p.path === '/index').status, 'migrated');
    assert.equal(state.pages.find((p) => p.path === '/about').status, 'directed');

    const count = finalizeGlobalState(state);
    assert.equal(count, 1);
    assert.equal(state.phase, 'migrated'); // advances because 1 succeeded
  });

  it('all-failure batch: global phase stays unchanged', () => {
    const state = { phase: 'directed', pages: [{ path: '/a', status: 'directed' }] };
    // no setPageMigrated calls — all failed
    const count = finalizeGlobalState(state);
    assert.equal(count, 0);
    assert.equal(state.phase, 'directed');
  });
});

describe('stardust prototype — after HTML persistence contract', () => {
  it('prototype viewer does not contain extractable after-panel markers', () => {
    // Confirms the old regex-extract approach would fail: the viewer uses
    // srcdoc= (not comment markers), so stardust:after markers are absent.
    // Migration must read .after.html directly — never parse the viewer.
    const viewerHtml = `<iframe srcdoc="&lt;h1&gt;After&lt;/h1&gt;"></iframe>`;
    const match = viewerHtml.match(/<!-- stardust:after -->([\s\S]*?)<!-- \/stardust:after -->/);
    assert.equal(match, null, 'viewer HTML must not contain stardust:after comment markers');
  });
});
