import { Command } from 'commander';
import { print, info } from '../lib/output.js';

// Agent skills management — wraps gh-upskill (https://github.com/ai-ecoverse/gh-upskill).
// Installs skills from GitHub, ClawHub, and Tessl registries.
// Mirrors the upskill CLI API: install, list, info, read, search.

const UPSKILL_INSTALLER = 'https://raw.githubusercontent.com/ai-ecoverse/gh-upskill/main/install.sh';
const KNOWN_REGISTRIES = {
  impeccable: 'pbakaus/impeccable',
  stardust:   'adobe/skills',
  snowflake:  'ai-ecoverse/snowflake',
};

export function makeSkillsCommand() {
  const skills = new Command('skills')
    .description('Agent skills management — install, list, search skills from GitHub and registries');

  // ─── install ───────────────────────────────────────────────────────────────
  skills
    .command('install [source]')
    .description('Install a skill from GitHub (owner/repo[@branch]), ClawHub (clawhub:<slug>), or a shorthand name')
    .option('--skill <name>', 'Install a specific skill from a multi-skill repo')
    .option('--path <subpath>', 'Subfolder path within the repo to filter skills')
    .option('--global', 'Install to ~/.agents/skills/ instead of .agents/skills/')
    .option('--dest <dir>', 'Custom install destination directory')
    .option('--force', 'Overwrite existing skills')
    .option('--list', 'List available skills without installing')
    .action(async (source, opts) => {
      const target = resolveSource(source);

      if (opts.list) {
        await runUpskill(['--list', target, ...buildFlags(opts)].filter(Boolean));
        return;
      }

      info(`Installing skill from: ${target}`);
      await runUpskill([target, ...buildFlags(opts)].filter(Boolean));
    });

  // ─── list ──────────────────────────────────────────────────────────────────
  skills
    .command('list')
    .description('List all installed skills in the current project')
    .option('--global', 'List globally installed skills (~/.agents/skills/)')
    .action(async (opts) => {
      await runUpskill(['list', ...(opts.global ? ['-g'] : [])]);
    });

  // ─── info ──────────────────────────────────────────────────────────────────
  skills
    .command('info <name>')
    .description('Show metadata for an installed skill (reads SKILL.md frontmatter)')
    .action(async (name) => {
      await runUpskill(['info', name]);
    });

  // ─── read ──────────────────────────────────────────────────────────────────
  skills
    .command('read <name>')
    .description('Print the full SKILL.md content for an installed skill')
    .action(async (name) => {
      await runUpskill(['read', name]);
    });

  // ─── search ────────────────────────────────────────────────────────────────
  skills
    .command('search <query>')
    .description('Search for skills across GitHub and ClawHub registries')
    .action(async (query) => {
      await runUpskill(['search', query]);
    });

  // ─── add ──────────────────────────────────────────────────────────────────
  // Convenience shortcuts for common EDS/DA skills
  skills
    .command('add <shorthand>')
    .description('Add a well-known EDS skill by shorthand: impeccable | stardust | snowflake')
    .option('--global', 'Install globally')
    .action(async (shorthand, opts) => {
      const source = KNOWN_REGISTRIES[shorthand];
      if (!source) {
        console.error(`Unknown shorthand: ${shorthand}`);
        console.error(`Known: ${Object.keys(KNOWN_REGISTRIES).join(', ')}`);
        process.exit(1);
      }

      const extra = shorthand === 'stardust' ? ['--path', 'plugins/stardust'] : [];
      info(`Adding ${shorthand} from ${source}…`);
      await runUpskill([source, ...extra, ...(opts.global ? ['-g'] : [])]);
    });

  // ─── update ────────────────────────────────────────────────────────────────
  skills
    .command('update [name]')
    .description('Update one or all installed skills to latest versions')
    .option('--global', 'Update global skills')
    .action(async (name, opts) => {
      if (name) {
        info(`Updating skill: ${name}`);
        // Re-install with force to pick up latest version
        await runUpskill([`--skill`, name, '--force', ...(opts.global ? ['-g'] : [])]);
      } else {
        info('Updating all installed skills…');
        // List installed skills, re-install each
        console.error('Use `da skills list` to see installed skills, then `da skills update <name>` for each.');
      }
    });

  // ─── bootstrap ─────────────────────────────────────────────────────────────
  skills
    .command('bootstrap')
    .description('Install gh-upskill CLI to PATH if not already present')
    .action(async () => {
      const { execSync } = await import('node:child_process');
      try {
        execSync('upskill --version', { stdio: 'pipe' });
        info('upskill is already installed.');
        return;
      } catch { /* not installed */ }

      info('Installing upskill from ai-ecoverse/gh-upskill…');
      try {
        execSync(`curl -fsSL ${UPSKILL_INSTALLER} | bash`, { stdio: 'inherit' });
        info('upskill installed. You may need to add ~/.local/bin to your PATH.');
      } catch (err) {
        console.error(`Failed to install upskill: ${err.message}`);
        console.error(`Manual install: curl -fsSL ${UPSKILL_INSTALLER} | bash`);
        process.exit(1);
      }
    });

  return skills;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveSource(source) {
  if (!source) return '';
  // ClawHub shorthand
  if (source.startsWith('clawhub:') || source.startsWith('tessl:')) return source;
  // Known shorthands
  if (KNOWN_REGISTRIES[source]) return KNOWN_REGISTRIES[source];
  // Already a full owner/repo[@branch] form
  return source;
}

function buildFlags(opts) {
  const flags = [];
  if (opts.skill) { flags.push('--skill', opts.skill); }
  if (opts.path) { flags.push('--path', opts.path); }
  if (opts.global) flags.push('-g');
  if (opts.dest) { flags.push('--dest-path', opts.dest); }
  if (opts.force) flags.push('--force');
  return flags;
}

async function runUpskill(args) {
  const { spawn } = await import('node:child_process');

  // Try each candidate; ENOENT means binary not found (not exit code 127)
  const candidates = ['upskill', 'gh upskill'];
  for (const cmd of candidates) {
    const [bin, ...rest] = cmd.split(' ');
    const code = await new Promise((resolve) => {
      const proc = spawn(bin, [...rest, ...args], { stdio: 'inherit' });
      proc.on('error', (err) => resolve(err.code === 'ENOENT' ? 'ENOENT' : 'ERROR'));
      proc.on('close', resolve);
    });
    if (code === 'ENOENT') continue;   // binary not found — try next candidate
    if (code === 'ERROR') continue;    // other spawn error — try next candidate
    if (code !== 0) process.exit(code);
    return;
  }

  // neither candidate found — guide user to bootstrap
  console.error('upskill CLI not found. Run: da skills bootstrap');
  console.error(`Or manually: curl -fsSL ${UPSKILL_INSTALLER} | bash`);
  process.exit(1);
}
