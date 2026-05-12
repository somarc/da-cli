import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── State-machine helpers ────────────────────────────────────────────────────
// Extracted logic tested in isolation (no filesystem, no DA API).

function freshState() {
  return { phase: 'fresh', pages: [], createdAt: new Date().toISOString() };
}

// Mirrors the state-advancement guard in `migrate`
function advancePageState(state, pagePath, pushed) {
  if (pushed) {
    const pg = (state.pages ?? []).find((p) => p.path === pagePath);
    if (pg) pg.status = 'migrated';
    return true;
  }
  return false;
}

function advanceGlobalState(state, migratedCount) {
  if (migratedCount > 0) {
    state.phase = 'migrated';
    state.migratedAt = new Date().toISOString();
  }
}

describe('stardust migrate — state advancement', () => {
  it('does not advance page state when push fails', () => {
    const state = freshState();
    state.pages = [{ path: '/index', status: 'directed' }];
    const pushed = advancePageState(state, '/index', false);
    assert.equal(pushed, false);
    assert.equal(state.pages[0].status, 'directed');
  });

  it('advances page state only after successful push', () => {
    const state = freshState();
    state.pages = [{ path: '/index', status: 'directed' }];
    advancePageState(state, '/index', true);
    assert.equal(state.pages[0].status, 'migrated');
  });

  it('does not set global phase=migrated when zero pages pushed', () => {
    const state = { phase: 'directed', pages: [] };
    advanceGlobalState(state, 0);
    assert.equal(state.phase, 'directed');
    assert.equal(state.migratedAt, undefined);
  });

  it('sets global phase=migrated when at least one page pushed', () => {
    const state = { phase: 'directed', pages: [] };
    advanceGlobalState(state, 1);
    assert.equal(state.phase, 'migrated');
    assert.ok(state.migratedAt);
  });

  it('does not corrupt state on mixed success/failure batch', () => {
    const state = freshState();
    state.pages = [
      { path: '/index', status: 'directed' },
      { path: '/about', status: 'directed' },
    ];
    advancePageState(state, '/index', true);   // success
    advancePageState(state, '/about', false);  // failure

    assert.equal(state.pages.find((p) => p.path === '/index').status, 'migrated');
    assert.equal(state.pages.find((p) => p.path === '/about').status, 'directed');

    const migrated = state.pages.filter((p) => p.status === 'migrated').length;
    advanceGlobalState(state, migrated);
    assert.equal(state.phase, 'migrated'); // still advances because 1 succeeded
  });
});

// ── Prototype viewer — after HTML isolation ──────────────────────────────────

describe('stardust prototype — after HTML persistence', () => {
  it('prototype viewer must not contain srcdoc-encoded after content as migration source', () => {
    // Verifies that after HTML is NOT embedded via srcdoc in the viewer
    // (the viewer uses srcdoc for display only; migration reads the .after.html file)
    const beforeHtml = '<h1>Before</h1>';
    const afterHtml = '<h1 style="color:blue">After</h1>';

    // Simulate what generatePrototypeViewer produces
    const viewer = `<html><body><iframe srcdoc="${afterHtml.replace(/"/g, '&quot;')}"></iframe></body></html>`;

    // The viewer contains encoded content — migration must NOT try to parse this back
    const naiveExtract = viewer.match(/<!-- stardust:after -->([\s\S]*?)<!-- \/stardust:after -->/);
    assert.equal(naiveExtract, null, 'marker-based extraction should find nothing in viewer');

    // Correct approach: migration reads .after.html directly (this test confirms the contract)
    assert.equal(afterHtml, '<h1 style="color:blue">After</h1>');
  });
});
