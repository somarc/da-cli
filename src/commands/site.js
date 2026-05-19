import { Command } from 'commander';
import { createClient, buildPlainHtmlUrl, DaApiError } from '../lib/da-client.js';
import { isEmptyContent } from './preview.js';
import { classify } from './route.js';
import { print, info } from '../lib/output.js';
import { listContentPaths, runConcurrent } from '../lib/paths.js';

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
    .option('--branch <branch>', 'Branch to check (default: main)')
    .action(async (repo, opts) => {
      const name = repo ?? (await resolveSiteName());
      const ghUser = opts.org ?? await getGhUser();
      const branch = opts.branch ?? 'main';

      const previewUrl = `https://${branch}--${name}--${ghUser}.aem.page`;
      const liveUrl = `https://${branch}--${name}--${ghUser}.aem.live`;

      info(`Checking pipeline health for ${ghUser}/${name} (branch: ${branch})…`);

      // Run checks in parallel
      const [fstab, helixStatus, plainHtml] = await Promise.all([
        checkFstab(ghUser, name),
        checkHelixStatus(ghUser, name, branch),
        checkPlainHtml(ghUser, name, branch),
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

  // ─── doctor ────────────────────────────────────────────────────────────────
  site
    .command('doctor [repo]')
    .description('Diagnose DA-backed EDS registration, content, code-bus, preview, and live state')
    .option('--org <org>', 'Org to check (default: configured org)')
    .option('--branch <branch>', 'Branch to check (default: main)')
    .option('--deep', 'Classify HTML documents under the site root and summarize preview/live drift')
    .option('--limit <n>', 'Max documents to classify with --deep', '50')
    .option('--concurrency <n>', 'Max parallel route probes with --deep', '8')
    .action(async (repo, opts) => {
      const client = await createClient({
        ...(opts.org ? { org: opts.org } : {}),
        ...(repo ? { repo } : {}),
        ...(opts.branch ? { branch: opts.branch } : {}),
      });

      info(`Running site doctor for ${client.org}/${client.repo} (${client.branch})…`);

      const [
        sidekick,
        codeAsset,
        daDocs,
        rootRoute,
        navRoute,
        footerRoute,
      ] = await Promise.all([
        checkSidekick(client),
        checkCodePath(client, '/styles/styles.css'),
        checkSharedDocs(client),
        classify(client, '/index').catch((err) => ({ path: '/index', ownership: 'probe-failed', error: err.message })),
        classify(client, '/nav').catch((err) => ({ path: '/nav', ownership: 'probe-failed', error: err.message })),
        classify(client, '/footer').catch((err) => ({ path: '/footer', ownership: 'probe-failed', error: err.message })),
      ]);

      const rows = [
        {
          check: 'Sidekick registration',
          status: sidekick.ok ? 'ok' : 'FAIL',
          detail: sidekick.detail,
        },
        {
          check: 'contentSourceType',
          status: sidekick.config?.contentSourceType === 'markup' ? 'ok' : 'WARN',
          detail: sidekick.config?.contentSourceType ?? 'missing',
        },
        {
          check: 'code-bus styles.css',
          status: codeAsset.ok ? 'ok' : 'WARN',
          detail: codeAsset.detail,
        },
        {
          check: 'DA shared docs',
          status: daDocs.ok ? 'ok' : 'WARN',
          detail: daDocs.detail,
        },
        routeRow('/index', rootRoute),
        routeRow('/nav', navRoute),
        routeRow('/footer', footerRoute),
      ];

      const deep = opts.deep ? await deepRouteSummary(client, opts) : null;
      if (deep) {
        rows.push(
          {
            check: 'deep route sample',
            status: deep.error || deep.failed > 0 || deep.previewMissing > 0 ? 'WARN' : 'ok',
            detail: deep.error ?? `${deep.checked}/${deep.total} checked; previewMissing=${deep.previewMissing}; liveMissing=${deep.liveMissing}; failed=${deep.failed}`,
          },
        );
      }

      print(rows);

      const recommendations = doctorRecommendations({
        sidekick,
        codeAsset,
        daDocs,
        routes: [rootRoute, navRoute, footerRoute],
        deep,
      });
      if (recommendations.length) {
        console.log('');
        console.log('Recommendations:');
        recommendations.forEach((rec) => console.log(`  - ${rec}`));
      }
    });

  return site;
}

async function checkSidekick(client) {
  try {
    const config = await client.helixSidekickConfig();
    const required = ['previewHost', 'liveHost', 'contentSourceUrl', 'contentSourceType'];
    const missing = required.filter((k) => !config?.[k]);
    return {
      ok: missing.length === 0,
      config,
      detail: missing.length === 0 ? `${config.previewHost} / ${config.liveHost}` : `missing: ${missing.join(', ')}`,
    };
  } catch (err) {
    return { ok: false, config: null, detail: err.message };
  }
}

async function checkCodePath(client, path) {
  try {
    const status = await client.helixCodeStatus(path);
    const codeStatus = status?.code?.status;
    return {
      ok: codeStatus === 200,
      detail: codeStatus ? `${codeStatus} ${status?.code?.sourceLocation ?? ''}`.trim() : 'missing code status',
    };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

async function checkSharedDocs(client) {
  const docs = ['/index.html', '/nav.html', '/footer.html'];
  const found = [];
  const missing = [];
  const errors = [];
  await Promise.all(docs.map(async (path) => {
    try {
      await client.sourceGet(path);
      found.push(path);
    } catch (err) {
      if (err instanceof DaApiError && err.status === 404) {
        missing.push(path);
      } else {
        errors.push(`${path}: ${err.message}`);
      }
    }
  }));
  if (errors.length) {
    return {
      ok: false,
      error: true,
      detail: `could not probe: ${errors.sort().join('; ')}`,
    };
  }
  return {
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.sort().join(', ')}` : `found: ${found.sort().join(', ')}`,
  };
}

function routeRow(path, verdict) {
  return {
    check: `route ${path}`,
    status: verdict.ownership === 'contentbus' && verdict.preview === 200 ? 'ok' : 'WARN',
    detail: `${verdict.ownership}; preview=${verdict.preview ?? 'n/a'} live=${verdict.live ?? 'n/a'} source=${verdict.sourceLocation ?? verdict.error ?? 'none'}`,
  };
}

function doctorRecommendations({ sidekick, codeAsset, daDocs, routes, deep }) {
  const recs = [];
  if (!sidekick.ok) {
    recs.push('Sidekick registration is incomplete. Re-register the site before reseeding content; content uploads can succeed while preview/live still fail.');
  }
  if (sidekick.config && sidekick.config.contentSourceType !== 'markup') {
    recs.push('For DA-backed HTML content, Sidekick config should include contentSourceType: "markup".');
  }
  if (!codeAsset.ok) {
    recs.push('Code-bus cannot see normal code assets. Confirm the AEM Sync GitHub App is installed and the repo was synced.');
  }
  if (daDocs.error) {
    recs.push('DA source probing failed. Refresh DA auth with `da auth login --refresh` before deciding content is missing.');
  } else if (!daDocs.ok) {
    recs.push('Create or restore /index.html, /nav.html, and /footer.html, then run `da preview tree / --commit`.');
  }
  if (routes.some((r) => r.ownership === 'orphan')) {
    recs.push('One or more key routes are orphaned. Check the DA source path and preview the corresponding .html document.');
  }
  if (routes.some((r) => r.preview === 200 && r.live !== 200)) {
    recs.push('Preview is healthy but live is not current. Run `da publish tree / --commit` when ready.');
  }
  if (deep?.previewMissing > 0) {
    recs.push('Some deep routes are missing preview. Run `da preview tree / --verify --commit` and inspect failed rows.');
  }
  if (deep?.liveMissing > 0) {
    recs.push('Some deep routes are missing live. Run `da publish tree / --verify-live --commit` when ready.');
  }
  return recs;
}

async function deepRouteSummary(client, opts) {
  const limit = Math.max(1, parseInt(opts.limit, 10) || 50);
  const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 8);
  let paths;
  try {
    paths = (await listContentPaths(client, '/', { ext: 'html' })).slice(0, limit);
  } catch (err) {
    return {
      total: 0,
      checked: 0,
      failed: 1,
      previewMissing: 0,
      liveMissing: 0,
      error: `could not list DA content: ${err.message}`,
    };
  }

  const results = await runConcurrent(
    paths.map((path) => () => classify(client, path).catch((err) => ({
      path,
      ownership: 'probe-failed',
      error: err.message,
    }))),
    concurrency,
  );
  return {
    total: paths.length,
    checked: results.length,
    failed: results.filter((r) => r.ownership === 'probe-failed').length,
    previewMissing: results.filter((r) => r.preview !== 200).length,
    liveMissing: results.filter((r) => r.live !== 200).length,
  };
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

async function checkHelixStatus(org, repo, branch = 'main') {
  try {
    const res = await fetch(`https://admin.hlx.page/status/${org}/${repo}/${branch}/`, {
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

async function checkPlainHtml(org, repo, branch = 'main') {
  const url = buildPlainHtmlUrl({ org, repo, branch }, '/');
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { ok: false, status: 'fail', detail: `HTTP ${res.status}` };
    const body = await res.text();
    if (isEmptyContent(body)) return { ok: false, status: 'empty', detail: 'Helix returned empty content — check DA document structure and AEM Sync' };
    const preview = body.trim().slice(0, 80).replace(/\s+/g, ' ');
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
