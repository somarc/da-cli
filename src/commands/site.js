import { Command } from 'commander';
import { createClient, buildPlainHtmlUrl } from '../lib/da-client.js';
import { print, info } from '../lib/output.js';

// EDS site scaffolding — creates new sites using ai-ecoverse/snowflake as template.
// Snowflake is the canonical EDS starter optimized for Stardust prototype conversion.

const SNOWFLAKE_TEMPLATE = 'ai-ecoverse/snowflake';
const AEM_SYNC_URL = 'https://github.com/apps/aem-sync';
const DA_LIVE = 'https://da.live';

export function makeSiteCommand() {
  const site = new Command('site').description('EDS site scaffolding and management');

  // ─── create ────────────────────────────────────────────────────────────────
  site
    .command('create <name>')
    .description(`Create a new EDS site from the snowflake template (${SNOWFLAKE_TEMPLATE}) — requires GitHub CLI`)
    .option('--org <org>', 'GitHub org/user to create repo under (default: your gh auth user)')
    .option('--da-org <daOrg>', 'DA org name (default: same as GitHub org)')
    .option('--private', 'Create as a private repo')
    .option('--no-da', 'Skip DA org setup (code-only site)')
    .action(async (name, opts) => {
      await requireGhCli();

      const ghUser = opts.org ?? await getGhUser();
      const daOrg = opts.daOrg ?? ghUser;
      const visibility = opts.private ? '--private' : '--public';
      const repoFull = `${ghUser}/${name}`;

      info(`Creating EDS site: ${repoFull}`);
      info(`Template: ${SNOWFLAKE_TEMPLATE}`);

      // 1. Fork snowflake template as new repo
      const { execSync } = await import('node:child_process');
      try {
        execSync(
          `gh repo create ${repoFull} --template ${SNOWFLAKE_TEMPLATE} ${visibility} --clone`,
          { stdio: 'inherit' },
        );
      } catch (err) {
        console.error(`Failed to create repo: ${err.message}`);
        process.exit(1);
      }

      // 2. Create fstab.yaml if DA is enabled
      if (opts.da !== false) {
        const fstab = `mountpoints:\n  /: https://content.da.live/${daOrg}/${name}/\n`;
        const { writeFile } = await import('node:fs/promises');
        try {
          await writeFile(`${name}/fstab.yaml`, fstab, 'utf8');
          execSync(`cd ${name} && git add fstab.yaml && git commit -m "chore: add fstab.yaml for DA content mount" && git push`, { stdio: 'inherit' });
          info('fstab.yaml created and pushed.');
        } catch (err) {
          info(`Warning: could not write fstab.yaml: ${err.message}`);
        }
      }

      // 3. Print next steps
      const previewUrl = `https://main--${name}--${ghUser}.aem.page`;
      const liveUrl = `https://main--${name}--${ghUser}.aem.live`;

      console.log('');
      console.log('Site created successfully.');
      console.log('');
      console.log('Next steps:');
      if (opts.da !== false) {
        console.log(`  1. Install AEM Sync on the repo: ${AEM_SYNC_URL}`);
        console.log(`     (Required for Helix to read DA content — select repo: ${repoFull})`);
        console.log(`  2. Create DA repo at: ${DA_LIVE}`);
        console.log(`     Org: ${daOrg}  /  Repo: ${name}`);
        console.log(`  3. Run: da auth login`);
        console.log(`  4. Preview your site: da preview page /`);
      }
      console.log(`  Preview URL: ${previewUrl}`);
      console.log(`  Live URL:    ${liveUrl}`);
      console.log('');
      console.log('To convert Stardust prototypes to this EDS site:');
      console.log(`  cd ${name} && da stardust extract ${previewUrl}`);

      print({ repo: repoFull, preview: previewUrl, live: liveUrl });
    });

  // ─── list ──────────────────────────────────────────────────────────────────
  site
    .command('list')
    .description('List EDS repos in your GitHub org (looks for fstab.yaml as EDS signal)')
    .option('--org <org>', 'GitHub org to search (default: your gh auth user)')
    .option('--limit <n>', 'Max repos to check', '30')
    .action(async (opts) => {
      await requireGhCli();
      const { execSync } = await import('node:child_process');

      const ghUser = opts.org ?? await getGhUser();
      info(`Listing EDS repos for ${ghUser}…`);

      try {
        const raw = execSync(
          `gh repo list ${ghUser} --limit ${opts.limit} --json name,url,description,isPrivate,pushedAt`,
          { encoding: 'utf8' },
        );
        const repos = JSON.parse(raw);

        // Filter to likely EDS repos (has fstab.yaml or matches EDS naming patterns)
        const edsRepos = [];
        for (const repo of repos) {
          try {
            execSync(
              `gh api repos/${ghUser}/${repo.name}/contents/fstab.yaml --silent`,
              { encoding: 'utf8', stdio: 'pipe' },
            );
            edsRepos.push({
              name: repo.name,
              url: repo.url,
              private: repo.isPrivate,
              pushed: repo.pushedAt?.slice(0, 10),
              preview: `https://main--${repo.name}--${ghUser}.aem.page`,
            });
          } catch {
            // no fstab.yaml — not an EDS repo
          }
        }

        if (edsRepos.length === 0) {
          info('No EDS repos found (no fstab.yaml detected).');
        } else {
          print(edsRepos);
        }
      } catch (err) {
        console.error(`Failed to list repos: ${err.message}`);
        process.exit(1);
      }
    });

  // ─── info ──────────────────────────────────────────────────────────────────
  site
    .command('info [repo]')
    .description('Show EDS site info and pipeline health — DA mount, content pipeline, preview status')
    .option('--org <org>', 'GitHub org (default: configured org)')
    .action(async (repo, opts) => {
      const name = repo ?? (await resolveSiteName());
      const ghUser = opts.org ?? await getGhUser();

      const previewUrl = `https://main--${name}--${ghUser}.aem.page`;
      const liveUrl = `https://main--${name}--${ghUser}.aem.live`;

      info(`Checking pipeline health for ${ghUser}/${name}…`);

      // Run checks in parallel
      const [fstab, helixStatus, plainHtml] = await Promise.all([
        checkFstab(ghUser, name),
        checkHelixStatus(ghUser, name),
        checkPlainHtml(ghUser, name),
      ]);

      const checks = [
        { check: 'fstab.yaml on main',       status: fstab.ok ? 'ok' : 'MISSING', detail: fstab.mount ?? fstab.error },
        { check: 'Helix content pipeline',    status: helixStatus.ok ? 'ok' : 'FAIL', detail: helixStatus.detail },
        { check: 'Content non-empty',         status: plainHtml.ok ? 'ok' : plainHtml.status === 'empty' ? 'EMPTY' : 'FAIL', detail: plainHtml.detail },
      ];

      print(checks);
      console.log('');
      console.log(`Preview: ${previewUrl}`);
      console.log(`Live:    ${liveUrl}`);

      const hasBlocker = checks.some((c) => c.status !== 'ok');
      if (hasBlocker) {
        console.log('');
        if (!fstab.ok) {
          console.log('  fstab.yaml missing — push one mapping / to https://content.da.live/{org}/{repo}/');
        }
        if (fstab.ok && helixStatus.ok && plainHtml.status === 'empty') {
          console.log('  Content pipeline empty. Check:');
          console.log('    - DA documents must be wrapped in <body><header></header><main>...</main><footer></footer></body>');
          console.log(`    - AEM Sync app installed on repo: ${AEM_SYNC_URL}`);
        }
      }
    });

  return site;
}

// ── Health check helpers ───────────────────────────────────────────────────────

async function checkFstab(org, repo) {
  const { execSync } = await import('node:child_process');
  try {
    const raw = execSync(`gh api repos/${org}/${repo}/contents/fstab.yaml --jq '.content'`, { encoding: 'utf8' }).trim();
    const content = Buffer.from(raw, 'base64').toString('utf8');
    const match = content.match(/\/:\s*(\S+)/);
    return { ok: true, mount: match?.[1] ?? content.trim() };
  } catch {
    return { ok: false, error: 'not found' };
  }
}

async function checkHelixStatus(org, repo) {
  try {
    const res = await fetch(`https://admin.hlx.page/status/${org}/${repo}/main/`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = await res.json();
    const preview = data?.preview;
    if (!preview) return { ok: false, detail: 'no preview entry' };
    return {
      ok: preview.status === 200,
      detail: preview.status === 200
        ? `${preview.status} (source: ${preview.sourceLocation ?? 'unknown'})`
        : `status ${preview.status}`,
    };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function checkPlainHtml(org, repo) {
  const url = `https://main--${repo}--${org}.aem.page/index.plain.html`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { ok: false, status: 'fail', detail: `HTTP ${res.status}` };
    const body = (await res.text()).trim();
    const isEmpty = body === '' || /^<div>\s*<\/div>$/i.test(body);
    if (isEmpty) return { ok: false, status: 'empty', detail: 'Helix returned empty content — check DA document structure and AEM Sync' };
    const preview = body.slice(0, 80).replace(/\s+/g, ' ');
    return { ok: true, detail: preview };
  } catch (err) {
    return { ok: false, status: 'fail', detail: err.message };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireGhCli() {
  const { execSync } = await import('node:child_process');
  try {
    execSync('gh --version', { stdio: 'pipe' });
  } catch {
    console.error('GitHub CLI (gh) is required. Install: https://cli.github.com');
    process.exit(1);
  }
}

async function getGhUser() {
  const { execSync } = await import('node:child_process');
  try {
    return execSync('gh api user --jq .login', { encoding: 'utf8' }).trim();
  } catch {
    console.error('Could not determine GitHub user. Run `gh auth login` first.');
    process.exit(1);
  }
}

async function resolveSiteName() {
  // Try to read from .da.json or package.json
  const { readFile } = await import('node:fs/promises');
  try {
    const da = JSON.parse(await readFile('.da.json', 'utf8'));
    if (da.repo) return da.repo;
  } catch { /* ok */ }
  try {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, '');
  } catch { /* ok */ }
  console.error('Cannot determine site name — pass it as argument or set repo in .da.json');
  process.exit(1);
}
