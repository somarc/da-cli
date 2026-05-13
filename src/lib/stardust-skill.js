// Stardust skill registry — version tracking and reference-file access.
// Canonical source: https://github.com/adobe/skills/tree/main/plugins/stardust
// Install: da skills add stardust  |  Update: da stardust update

export const STARDUST_CANONICAL = 'https://github.com/adobe/skills/tree/main/plugins/stardust';
const STARDUST_REPO = 'adobe/skills';
const STARDUST_PATH = 'plugins/stardust';
const RAW_BASE = `https://raw.githubusercontent.com/${STARDUST_REPO}/main/${STARDUST_PATH}`;

// Ordered search: project-local first, then global
function skillSearchPaths() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
    '.agents/skills/stardust',
    `${home}/.agents/skills/stardust`,
  ];
}

export async function getSkillPath() {
  const { access } = await import('node:fs/promises');
  for (const p of skillSearchPaths()) {
    try {
      await access(`${p}/TILE.json`);
      return p;
    } catch { /* not present */ }
  }
  return null;
}

export async function loadLocalTile() {
  const skillPath = await getSkillPath();
  if (!skillPath) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(`${skillPath}/TILE.json`, 'utf8'));
  } catch { return null; }
}

export async function fetchRemoteTile() {
  try {
    const res = await fetch(`${RAW_BASE}/TILE.json`, {
      headers: { 'User-Agent': 'da-cli/stardust-version-check' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export async function checkStaleness() {
  const [local, remote] = await Promise.all([loadLocalTile(), fetchRemoteTile()]);
  return {
    localVersion: local?.version ?? null,
    remoteVersion: remote?.version ?? null,
    installed: !!local,
    stale: local && remote ? compareVersions(local.version, remote.version) < 0 : false,
    upToDate: local && remote ? compareVersions(local.version, remote.version) >= 0 : false,
  };
}

// Load the 127-palette library from the installed skill.
// Returns null when skill is not installed — callers should fall back to inline palettes.
export async function loadPaletteLibrary() {
  const skillPath = await getSkillPath();
  if (!skillPath) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(
      `${skillPath}/direct/reference/palettes/palette_library.json`, 'utf8',
    );
    return JSON.parse(raw);
  } catch { return null; }
}

// Load any reference file from the installed skill by relative path (no leading slash).
// e.g. loadReferenceFile('stardust/reference/intent-dimensions.md')
export async function loadReferenceFile(relPath) {
  const skillPath = await getSkillPath();
  if (!skillPath) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    return readFile(`${skillPath}/${relPath}`, 'utf8');
  } catch { return null; }
}

// Spawn upskill to install/update from canonical source.
// Returns exit code (0 = success, non-zero = failure, 'ENOENT' = not installed).
export async function runUpskillUpdate() {
  const { spawn } = await import('node:child_process');
  const args = [STARDUST_REPO, '--path', STARDUST_PATH, '--force'];
  return new Promise((resolve) => {
    const proc = spawn('upskill', args, { stdio: 'inherit' });
    proc.on('error', (err) => resolve(err.code === 'ENOENT' ? 'ENOENT' : 'ERROR'));
    proc.on('close', resolve);
  });
}

// Exported for testing — pure semver comparison.
// Returns -1 (a < b), 0 (equal), 1 (a > b).
export function compareVersions(a, b) {
  const parse = (v) => (v || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}
