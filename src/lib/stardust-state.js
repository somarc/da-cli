// Pure state-machine helpers for the stardust pipeline.
// Exported so tests can import and assert against production logic directly.

export function freshState() {
  return { phase: 'fresh', pages: [], createdAt: new Date().toISOString() };
}

// Mark a single page as migrated in state. Call only after successful upload.
export function setPageMigrated(state, pagePath) {
  const pg = (state.pages ?? []).find((p) => p.path === pagePath);
  if (pg) pg.status = 'migrated';
}

// Advance the global phase to 'migrated' only if at least one page succeeded.
// Returns the count of migrated pages.
export function finalizeGlobalState(state) {
  const count = (state.pages ?? []).filter((p) => p.status === 'migrated').length;
  if (count > 0) {
    state.phase = 'migrated';
    state.migratedAt = new Date().toISOString();
  }
  return count;
}

export async function loadState() {
  const { readFile, mkdir } = await import('node:fs/promises');
  try {
    await mkdir('.stardust', { recursive: true });
    const raw = await readFile('.stardust/state.json', 'utf8');
    return JSON.parse(raw);
  } catch {
    return freshState();
  }
}
