# da-cli

CLI for Adobe Edge Delivery Services via the DA Admin API.

```
npm install -g @somarc/da-cli
```

Requires Node >= 18 and Python 3 (used by `da auth login` to cache the token). Zero npm runtime dependencies beyond `commander` and `js-yaml`.

---

## Quick start

```bash
# 1. Authenticate
da auth login

# 2. Set project context (or pass --org / --repo flags each time)
da config init          # interactive setup, writes .da.json in current directory

# 3. List content
da content list /
```

---

## Global flags

These flags apply to every command and are resolved before any subcommand runs.

| Flag | Description |
|------|-------------|
| `--org <org>` | DA org (overrides `.da.json` and `~/.da/config.json`) |
| `--repo <repo>` | DA repo |
| `--env <env>` | Environment: `dev` \| `stage` \| `prod` (default: `prod`) |
| `--format <fmt>` | Output format: `table` \| `json` \| `md` (default: `table`) |
| `--dry-run` | Show what would happen without mutating (default for write operations) |
| `--commit` | Execute mutations (required to override dry-run on all write operations) |
| `--quiet` | Suppress progress output, print only results |
| `--verbose` | Print full request/response details |

Notes:
- Root `--env` means the **DA admin environment**: `dev | stage | prod`.
- `da index validate` and `da index query` also define a **subcommand-local** `--env` with a different meaning: `preview | live`.
- For write operations, prefer passing root flags before the subcommand, for example: `da --commit publish page /index`.

---

## Configuration

Config is resolved in this precedence order (highest wins):

```
CLI flags  >  per-command overrides  >  project .da.json  >  ~/.da/config.json  >  defaults
```

In addition to `org`, `repo`, and `env`, config may also include `branch`. Commands that support `--branch` use that as the default when the flag is omitted.

### `da config init`

Interactive setup — prompts for org, repo, env and writes to `.da.json` in the current directory.

```bash
da config init           # project .da.json
da config init --global  # ~/.da/config.json
```

### `da config get <key>`

Print a single resolved config value.

```bash
da config get org
```

### `da config set <key> <value>`

Write a key to project or global config.

```bash
da config set repo my-site
da config set org my-org --global
da config set branch feature/my-work
```

### `da config show`

Print full resolved config with source annotation (`flag / project / global / default`).

```bash
da config show
da config show --json
```

---

## Authentication

Tokens are cached at `~/.aem/da-token.json`.

### `da auth login`

Obtain and cache a Bearer token. Requires:
- `npx` (bundled with Node) to invoke `github:adobe-rnd/da-auth-helper` (fetched on first login)
- `python3` in PATH (used to write the token cache at `~/.aem/da-token.json`)

```bash
da auth login            # uses cached token if still valid
da auth login --refresh  # force re-auth
```

### `da auth logout`

Remove the cached token.

### `da auth status`

Show token validity and time remaining.

```bash
da auth status
# valid  expires 5/15/2026, 2:30:00 PM  (~47 min remaining)
```

### `da auth token`

Print the raw Bearer token to stdout — useful for piping to curl or populating env vars.

```bash
export TOKEN=$(da auth token)
curl -H "Authorization: Bearer $TOKEN" https://admin.da.live/list/myorg/myrepo
```

---

## Content

CRUD operations on DA source documents.

### `da content list [path]`

List documents and folders at a path (default: repo root).

```bash
da content list /
da content list /blog
```

### `da content tree [prefix]`

Recursively list source documents under a prefix. This is useful when preparing an explicit path set for bulk preview or publish.

```bash
da content tree /
da content tree / --ext html
da content tree /blog --ext html --format json
```

### `da content get <path>`

Fetch a source document to stdout or a file.

```bash
da content get /index.html
da content get /blog/post.html -o post.html
```

### `da content put <path> <file>`

Upload a document. Dry-run by default — shows diff before writing.

```bash
da content put /index.html ./index.html          # dry-run: shows diff
da content put /index.html ./index.html --commit # writes to DA
```

Warns if the HTML lacks a `<main>` wrapper — Helix extracts only content inside `<main>`, so an unwrapped document will render empty.

### `da content delete <path>`

Delete a source document. Requires `--commit`.

```bash
da content delete /old-page.html --commit
```

### `da content move <src> <dst>`

Move or rename a document. Requires `--commit`.

```bash
da content move /old-name.html /new-name.html --commit
```

### `da content copy <src> <dst>`

Copy a document to a new path. Requires `--commit`.

```bash
da content copy /template.html /new-page.html --commit
```

### `da content versions <path>`

List version history for a document.

```bash
da content versions /index.html
```

---

## Preview

Triggers the EDS content pipeline. Updates `*.aem.page` only — use `da publish` to promote to `*.aem.live`.

Preview is a two-step operation:
1. Flush the DA editor cache (`admin.da.live/preview`)
2. Trigger the Helix content pipeline (`admin.hlx.page/preview`)

After a successful preview, da-cli fetches `.plain.html` and warns if the content pipeline returned empty content.

### `da preview page <path>`

Preview a single page.

```bash
da preview page /index
da preview page /blog/post --branch feature-branch
```

### `da preview pages <source>`

Batch preview — accepts a local file of paths (one per line) or a DA path prefix (recursively lists all pages under it).

```bash
da preview pages /blog                  # all pages under /blog
da preview pages paths.txt              # file of newline-delimited paths
da preview pages /blog --concurrency 10
```

### `da preview tree [prefix]`

Preview every HTML source document under a DA prefix. This is the agent-friendly path for full-site preview because it includes shared documents such as `/nav.html` and `/footer.html` when they exist.

```bash
da preview tree / --commit
da preview tree /docs --concurrency 10 --commit
da preview tree / --verify --commit   # fail if any .plain.html is empty or unreachable
```

### `da preview status <path>`

Check Helix preview pipeline status for a path.

```bash
da preview status /index
```

---

## Publish

Promotes previewed pages to the live CDN (`*.aem.live`). Step 2 after `da preview`. All publish operations require `--commit`.

### `da publish page <path>`

Promote a single page to live CDN.

```bash
da publish page /index --commit
```

### `da publish pages <source>`

Batch publish — same source format as `da preview pages`.

```bash
da publish pages /blog --commit
da publish pages paths.txt --commit --concurrency 10
```

### `da publish tree [prefix]`

Publish every HTML source document under a DA prefix to `*.aem.live`. Run `da preview tree` first.

```bash
da publish tree / --commit
da publish tree /docs --concurrency 10 --commit
da publish tree / --verify-live --commit   # fail if any canonical live URL is unreachable
```

### `da publish unpublish <path>`

Remove a page from the live CDN.

```bash
da publish unpublish /old-page --commit
```

---

## Deploy

Runs the normal 2-step workflow in one command: preview first, then publish. Preview always runs; publish is still gated by root `--commit`.

### `da deploy page <path>`

Preview a single page, then promote it to live CDN if `--commit` is set.

```bash
da deploy page /index
da --commit deploy page /index
da --commit deploy page /blog/post --branch feature-branch
```

### `da deploy pages <source>`

Batch preview first, then publish only the pages that previewed successfully.

```bash
da deploy pages /blog
da --commit deploy pages /blog --concurrency 10
da --commit deploy pages paths.txt --branch feature-branch
```

---

## Route

Classify and manage DA route ownership. Used before any destructive content operation to understand who owns a route.

**Ownership classifications:**

| Class | Meaning |
|-------|---------|
| `contentbus` | DA-owned — safe to do DA content operations |
| `codebus` | Code-repo owned — DA operations will not affect this route |
| `hybrid` | Both DA source and code-repo content present |
| `orphan` | No owner found |
| `probe-failed` | API error — classification incomplete, do not act |

Exit codes match classification for shell scripting: `0=contentbus`, `2=orphan`, `3=codebus`, `4=hybrid`, `5=probe-failed`.

### `da route classify <path>`

Probe a single route.

```bash
da route classify /blog/post
# { path: '/blog/post', ownership: 'contentbus', daSource: true, preview: 200, live: 200 }
```

### `da route canonical <path>`

Show the DA source path, canonical browser URL path, preview URL, live URL, and `.plain.html` URL for a route. This is intended for discovery and does not use the classification exit-code contract; use `da route classify` when a script must branch on ownership.

```bash
da route canonical /index.html
# canonicalPath: /
# previewUrl: https://main--my-site--my-org.aem.page/
# liveUrl:    https://main--my-site--my-org.aem.live/
```

### `da route audit`

Classify every route under a path prefix.

```bash
da route audit --prefix /blog
da route audit --prefix / --concurrency 20
```

### `da route clean <path>`

Delete DA source for a route and flush preview. Dry-run default.

```bash
da route clean /old-page               # dry-run: shows classification
da route clean /old-page --commit      # delete source + flush preview
da route clean /old-page --force --commit  # bypass ownership check
```

---

## Site

Diagnose DA-backed EDS site registration, content, code-bus, preview, and live state.

### `da site doctor [repo]`

Run a compact health check for Sidekick registration, `contentSourceType`, code-bus visibility, shared DA docs, and key routes.

```bash
da site doctor my-site --org my-org
da site doctor my-site --org my-org --deep --limit 100 --concurrency 10
```

Use `--deep` to sample HTML documents under the site root and summarize preview/live drift. If DA listing is unavailable, doctor reports that as a diagnostic row instead of aborting with a stack trace.

---

## Index

Inspect and query `helix-query.yaml` indices. Searches upward from `cwd` to find the file.

### `da index show`

Print index definitions with field list.

```bash
da index show
da index show --file ./helix-query.yaml
```

### `da index validate`

Check that fields defined in `helix-query.yaml` exist in the live query-index responses.

Note: this subcommand's `--env` means query target host (`preview` or `live`), not the root DA admin environment flag.

```bash
da index validate
da index validate --env preview
```

Exits with code 1 if any fields are missing from the live index.

### `da index query <index-name>`

Run a live query against a named index.

Note: this subcommand's `--env` means query target host (`preview` or `live`), not the root DA admin environment flag.

```bash
da index query blog
da index query blog --limit 100 --offset 0
da index query blog --filter type=article --filter author=jane
da index query blog --env preview
```

---

## Audit

Validate EDS page content via `.plain.html`. Fetches from the EDS preview domain — the page must be previewed first.

### `da audit semantics <path>`

Check heading hierarchy, metadata quality, and link quality.

```bash
da audit semantics /index
```

### `da audit blocks <path>`

Validate block structure and decoration.

```bash
da audit blocks /blog/post
```

### `da audit full <path>`

Run all audits with unified severity-classified report. Exits with code 1 if any `error`-severity findings are present.

```bash
da audit full /index
```

### `da audit contracts`

List all block class names used across a path prefix (block inventory).

```bash
da audit contracts --prefix /blog
```

---

## Migrate

Import external web pages into DA as EDS content. Scrapes the source URL, extracts main content, converts to EDS HTML structure, and uploads to DA.

The HTML conversion pipeline: fetch → extract `<main>` → absolutize URLs → strip scripts/styles/noise → convert recognizable patterns to EDS blocks → wrap in EDS document skeleton with metadata block.

### `da migrate import <url>`

Import a single URL. Derives DA path from URL pathname by default.

```bash
da migrate import https://old-site.com/about                   # dry-run: shows generated HTML + diff
da migrate import https://old-site.com/about --commit          # uploads + triggers preview
da migrate import https://old-site.com/about --path /about-us --commit
da migrate import https://old-site.com/about --no-preview --commit
```

### `da migrate batch <url-file>`

Import multiple URLs from a newline-delimited file. Supports resumable jobs — interrupted batches can be resumed with `--job-id`.

```bash
da migrate batch urls.txt --commit
da migrate batch urls.txt --path-prefix /blog --concurrency 5 --commit
da migrate batch urls.txt --job-id abc12345 --commit  # resume interrupted job
```

Lines starting with `#` are treated as comments.

### `da migrate status [job-id]`

Show batch import progress.

```bash
da migrate status                # list all jobs
da migrate status abc12345       # detail for a specific job
```

### `da migrate validate <path>`

Run a full audit on an imported page via its EDS preview URL.

```bash
da migrate validate /about-us
```

---

## Pipeline

Execute declarative YAML pipeline DAGs — sequences and parallelizes `da` commands with dependency tracking, approval gates, and resumable state.

### Pipeline YAML format

```yaml
pipeline:
  name: "Publish blog posts"
  context:
    org: my-org
    repo: my-site
  steps:
    - id: preview-index
      command: "preview page /index"
    - id: preview-blog
      command: "preview pages /blog --concurrency 10"
      depends_on: [preview-index]
    - id: publish-all
      command: "publish pages /blog --commit"
      depends_on: [preview-blog]
      requires_approval: true
      timeout: 5m
      continue_on_error: false
```

Steps at the same dependency level run in parallel. Timeouts accept `s`, `m`, or `h` suffixes.

### `da pipeline run <yaml-file>`

Execute a pipeline. State is persisted to `~/.da/pipeline-runs/<run-id>.json`.

```bash
da pipeline run publish-blog.yaml
da pipeline run publish-blog.yaml --commit  # propagates --commit to all write steps
```

### `da pipeline status [run-id]`

Show pipeline run progress.

```bash
da pipeline status               # list all runs
da pipeline status abc12345      # step-by-step detail for a specific run
```

### `da pipeline abort <run-id>`

Signal a running pipeline to stop before its next batch. In-flight steps complete.

```bash
da pipeline abort abc12345
```

---

## Code

EDS code-bus operations — sync and inspect code assets.

### `da code sync [path]`

Trigger code-bus sync for a path (invalidates CDN for JS/CSS/HTML assets).

```bash
da code sync /blocks/hero/hero.js
da code sync /                      # sync everything
```

### `da code status [path]`

Check code-bus sync status for a path.

### `da code job <jobId>`

Poll status of an async Helix admin job.

```bash
da code job abc123
da code job abc123 --wait --timeout 180  # block until terminal state
```

### `da code sidekick get`

Print the current Helix sidekick configuration as JSON.

### `da code sidekick set <json>`

Merge JSON into the sidekick config. Requires `--commit`.

```bash
da code sidekick set '{"plugins":[{"id":"my-plugin","url":"https://example.com"}]}' --commit
```

### `da code purge <path>`

Purge CDN cache for a path. Requires `--commit`.

```bash
da code purge /styles/fonts.css --commit
```

---

## Design

Design quality checks powered by the impeccable rule set — detect anti-patterns in EDS pages. Source can be a local HTML file, a URL, or a DA path (`/my-page`).

### Anti-pattern categories

| Category | Description |
|----------|-------------|
| `ai-slop` | AI-generated content tells (em-dashes, "delve into", "tapestry of", etc.) |
| `quality` | Design quality violations (gradient text, glassmorphism, bounce easing, pure black backgrounds) |
| `eds` | EDS-specific problems (missing block structure, invalid markup patterns) |

### `da design detect <source>`

Scan for design anti-patterns.

```bash
da design detect /index
da design detect https://my-site.aem.page/blog/post
da design detect ./local.html --category ai-slop
da design detect /page --severity error       # errors only
da design detect /page --fix-hints            # include fix suggestions
```

Exits with code 1 if any `error`-severity patterns are found.

### `da design rules`

List all anti-pattern rules.

```bash
da design rules
da design rules --category ai-slop
da design rules --json
```

### `da design audit <source>`

Comprehensive scan across all categories with fix hints — grouped report by category.

```bash
da design audit /index
da design audit /index --severity error
```

### `da design token-check <source>`

Verify the Stardust `:root` CSS custom-property contract is present.

Required tokens: `--color-brand-primary`, `--color-brand-secondary`, `--type-scale-base`, `--space-unit`.

```bash
da design token-check /index
```

---

## Stardust

4-phase EDS site redesign pipeline: **extract → direct → prototype → migrate**.

State is stored in `.stardust/state.json` relative to the current working directory. Run `da stardust` (no subcommand) to see current state and next step.

### Phase 1 — `da stardust extract [url]`

Crawl an existing site (or fetch from DA) and extract brand/content into `.stardust/current/`. Generates `PRODUCT.md` and `DESIGN.md` stubs seeded with detected fonts, colors, and headings.

```bash
da stardust extract https://old-site.com --pages 10
da stardust extract              # fetch from DA (requires org/repo config)
```

### Phase 2 — `da stardust direct [phrase]`

Resolve a design intent phrase into design dimensions and produce:
- `PRODUCT.md` — target design brief
- `DESIGN.md` — target design spec with CSS custom-property skeleton
- `DESIGN.json` — machine-readable dimensions + palette
- `.stardust/direction.md` — reasoning trace

Resolves 5 dimensions from the phrase: register, tone, density, expressive axis, distinctiveness.

```bash
da stardust direct "clean minimal product site, airy and professional"
da stardust direct --palette ocean-depths --tone serious
```

### Phase 3 — `da stardust prototype [page]`

Generate before/after HTML prototype viewers in `.stardust/prototypes/`. Opens in any browser for visual review.

```bash
da stardust prototype /index
da stardust prototype --all       # generate for all extracted pages
```

### Phase 4 — `da stardust migrate [page]`

Push approved designs to DA via the API and trigger preview. Requires `--commit`.

```bash
da stardust migrate /index --commit
da stardust migrate --all --commit
```

After migration, publish with `da publish pages / --commit`.

### `da stardust reset`

Reset state back to `fresh` without deleting `.stardust/` files.

---

## Site

EDS site scaffolding and management. Requires [GitHub CLI](https://cli.github.com).

### `da site create <name>`

Create a new EDS site from the `ai-ecoverse/snowflake` template — forks the template, creates `fstab.yaml`, and prints the AEM Sync setup steps.

```bash
da site create my-new-site
da site create my-new-site --org my-github-org --da-org my-da-org
da site create my-new-site --private
da site create my-new-site --no-da    # code-only, skip DA setup
```

After creation:
1. Install [AEM Sync](https://github.com/apps/aem-sync) on the new repo
2. Create the matching DA repo at [da.live](https://da.live)
3. Run `da auth login` and `da preview page /`

### `da site list`

List EDS repos in your GitHub org (detected by presence of `fstab.yaml`).

```bash
da site list
da site list --org my-org --limit 50
```

### `da site info [repo]`

Show EDS site pipeline health — checks `fstab.yaml`, Helix content pipeline, and content non-empty.

```bash
da site info
da site info my-site --org my-org
da site info my-site --org my-org --branch feature-branch
```

### `da site doctor [repo]`

Diagnose DA-backed EDS registration and delivery state. This command checks Sidekick registration, `contentSourceType`, code-bus visibility, shared DA documents, and route classification for `/index`, `/nav`, and `/footer`.

Use this before reseeding content when preview/publish fails with vague 404s.

```bash
da site doctor
da site doctor my-site --org my-org
da site doctor my-site --org my-org --branch feature-branch
```

Common failure signals:

- Sidekick registration missing `previewHost`, `liveHost`, or `contentSourceType`
- DA content exists but key routes classify as `orphan`
- Preview is healthy but live is stale
- Code-bus cannot see normal repo assets

---

## Skills

Agent skills management — install, list, and search skills from GitHub, ClawHub, and Tessl registries. Wraps [gh-upskill](https://github.com/ai-ecoverse/gh-upskill).

### `da skills bootstrap`

Install the `upskill` CLI to PATH if not already present.

```bash
da skills bootstrap
```

### `da skills install [source]`

Install a skill from GitHub (`owner/repo[@branch]`), ClawHub (`clawhub:<slug>`), or a known shorthand.

```bash
da skills install pbakaus/impeccable
da skills install adobe/skills --skill stardust --path plugins/stardust
da skills install clawhub:my-skill
da skills install impeccable --global    # install to ~/.agents/skills/
da skills install impeccable --force     # overwrite existing
da skills install adobe/skills --list    # list available skills without installing
```

### `da skills add <shorthand>`

Convenience shorthand for well-known EDS/DA skills.

| Shorthand | Source |
|-----------|--------|
| `impeccable` | `pbakaus/impeccable` |
| `stardust` | `adobe/skills` (plugins/stardust path) |
| `snowflake` | `ai-ecoverse/snowflake` |

```bash
da skills add impeccable
da skills add stardust --global
```

### `da skills list`

List all installed skills in the current project.

```bash
da skills list
da skills list --global
```

### `da skills info <name>`

Show SKILL.md frontmatter for an installed skill.

### `da skills read <name>`

Print full SKILL.md for an installed skill.

### `da skills search <query>`

Search for skills across GitHub and ClawHub registries.

```bash
da skills search eds block
```

### `da skills update [name]`

Update one installed skill to latest.

```bash
da skills update impeccable
```

---

## Safety model

Write operations (put, delete, move, copy, publish, deploy, migrate, clean, sidekick set, purge) are **dry-run by default**. They show what would change (diff, classification, or plan) without mutating anything.

Pass `--commit` at the root level to enable writes:

```bash
da --commit content put /index.html ./index.html
da --commit publish page /index
da --commit deploy page /index
```

The `--commit` flag propagates through pipeline steps, so a single flag at the root gates an entire pipeline run.

---

## Typical workflows

### New EDS site from scratch

```bash
da site create my-site
# Follow the printed AEM Sync + DA setup steps
cd my-site
da config init
da auth login
da preview page /
```

### Batch publish a folder

```bash
da preview pages /blog --concurrency 10
da --commit publish pages /blog --concurrency 10
```

### Preview + publish in one command

```bash
da --commit deploy page /index
da --commit deploy pages /blog --concurrency 10
```

### Import and publish an external page

```bash
da migrate import https://old-site.com/about --commit
da publish page /about --commit
```

### Redesign a site with Stardust

```bash
da stardust extract https://current-site.com --pages 20
da stardust direct "modern minimal SaaS product site, airy neutral"
da stardust prototype --all
# Review .stardust/prototypes/*.html in browser
da stardust migrate --all --commit
da --commit publish pages / --concurrency 10
```

### Audit before publishing

```bash
da audit full /index
da design audit /index
```

### Declarative publish pipeline

```yaml
# publish.yaml
pipeline:
  name: "Full site publish"
  steps:
    - id: audit
      command: "audit full /index"
    - id: preview-all
      command: "preview pages / --concurrency 10"
      depends_on: [audit]
    - id: publish-all
      command: "publish pages / --commit --concurrency 10"
      depends_on: [preview-all]
      requires_approval: true
```

```bash
da --commit pipeline run publish.yaml
```

---

## EDS content structure

DA documents must use the full EDS HTML skeleton or Helix will extract empty content:

```html
<body>
  <header></header>
  <main>
    <div>
      <!-- page content -->
      <div class="metadata">
        <div><div>title</div><div>My Page Title</div></div>
        <div><div>description</div><div>Page description</div></div>
      </div>
    </div>
  </main>
  <footer></footer>
</body>
```

EDS blocks are authored as `<div class="block-name">` tables — see [EDS block authoring docs](https://www.aem.live/developer/block-collection).

---

## Troubleshooting

**`da preview page` returns a URL but the page renders empty**

1. DA document missing `<body><header></header><main>...</main><footer></footer></body>` wrapper
2. [AEM Sync](https://github.com/apps/aem-sync) GitHub App not installed on the repo
3. `fstab.yaml` missing or not committed on `main`

Run `da site info` for a health check that surfaces all three.

**`Unauthorized — run da auth login`**

Your token has expired. Run `da auth login` (or `da auth login --refresh`).

**`Route /foo is codebus-owned`** (from `da route clean`)

The route is served from the code repo, not DA. Deleting the DA source won't remove it. Pass `--force` only if you understand why you want to clean the DA source anyway.

---

## Development

```bash
git clone https://github.com/somarc/da-cli.git
cd da-cli
npm test
```

Tests use Node's built-in test runner — no additional test framework required.

```bash
node --test src/**/*.test.js
```

To run the CLI locally without installing:

```bash
node ./bin/da.js auth status
```

---

## License

Apache-2.0
