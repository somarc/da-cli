# AGENTS.md — da-cli

Agent orientation guide for `@somarc/da-cli` — a CLI for managing Adobe Edge Delivery Services (EDS) sites via the DA (Document Authoring) Admin API.

This file is the agent-facing companion to [README.md](./README.md). Keep command names, flags, safety rules, and examples synchronized with the README; use README.md as the user-facing reference and this file as the operational checklist for agents.

---

## What This Tool Does

`da` is the primary operator for EDS content pipelines. It wraps two APIs:

- **DA Admin API** (`admin.da.live`) — content source CRUD, versioning, route management
- **Helix Admin API** (`admin.hlx.page`) — preview/publish pipeline, CDN, code-bus

Every destructive operation is **dry-run by default**. Pass `--commit` at the root level to execute writes.

---

## Prerequisites

| Dependency | Required for |
|---|---|
| Node >= 18 | Everything |
| `python3` | `da auth login` (token cache write) |
| `npx` | `da auth login` (spawns `da-auth-helper`) |
| `gh` (GitHub CLI) | `da site create` only |
| `upskill` | `da skills *` (install via `da skills bootstrap`) |

Install the CLI:
```bash
npm install -g @somarc/da-cli
```

---

## Authentication

Tokens are Adobe IMS Bearer tokens cached at `~/.aem/da-token.json`.

```bash
da auth login          # obtain and cache token (spawns da-auth-helper via npx)
da auth login --refresh  # force re-auth even if cached token is valid
da auth status         # check token validity and expiration
da auth token          # print raw Bearer token to stdout (for piping to curl)
da auth logout         # remove cached token
```

Auto-refresh: if the cached token expires within 30 seconds, the next API call refreshes it automatically.

---

## Configuration

`.env` files are loaded automatically by searching upward from the current directory. `DA_*` and `AEM_*` environment variables are supported for the common root options.

Resolution precedence: **per-command overrides > CLI flags > `DA_*`/`AEM_*` environment > project `.da.json` > `~/.da/config.json` > defaults**

```bash
da config init [--global]        # interactive setup: prompts for org, repo, env
da config show [--json]          # show full resolved config with source annotation
da config get <key>              # print single value
da config set <key> <value>      # write to project config (add --global for user-level)
```

**Project config** (`.da.json`, searched upward from cwd):
```json
{ "org": "my-org", "repo": "my-site", "branch": "main" }
```

**Global config** (`~/.da/config.json`):
```json
{ "org": "my-default-org", "env": "prod" }
```

Config keys: `org`, `repo`, `env` (`prod`|`stage`|`dev`, default `prod`), `branch` (default `main`).

Environment equivalents:

```bash
DA_ORG=my-org          # or AEM_ORG
DA_REPO=my-site        # or AEM_REPO
DA_ENV=prod            # or AEM_ENV
DA_BRANCH=main         # or AEM_BRANCH
DA_FORMAT=json         # or AEM_FORMAT
DA_LOG_LEVEL=debug     # or AEM_LOG_LEVEL
DA_LOG_FILE=./da.log   # or AEM_LOG_FILE
DA_REQUEST_ID=run-123  # or AEM_REQUEST_ID
```

---

## Global Flags

These apply to every command:

| Flag | Effect |
|---|---|
| `--org <org>` | DA org (overrides config) |
| `--repo <repo>` | DA repo |
| `--env <env>` | `prod` \| `stage` \| `dev` (default: `prod`) |
| `--commit` | Execute mutations — required for all write operations |
| `--dry-run` | Explicit dry-run (default behaviour, but useful to make intent clear) |
| `--format <fmt>` | `table` \| `json` \| `md` (auto-detected from TTY) |
| `--log-level <level>` | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `--log-file <file>` | Append logs to a file instead of stderr |
| `--request-id <id>` | Send `x-request-id` on DA/Helix admin API calls |
| `--quiet` | Suppress progress output |
| `--verbose` | Print full request/response details |

Root `--env` means DA admin environment: `dev | stage | prod`. `da index validate` and `da index query` also define a subcommand-local `--env preview|live` for the query target host.

---

## Safety Model

**All mutations are no-ops unless `--commit` is passed at the root level.**

```bash
da content put /index index.html          # shows diff, does NOT upload
da --commit content put /index index.html # uploads
```

`--commit` propagates through nested commands and pipeline steps. Always confirm intent before passing it.

---

## Command Reference

### Content CRUD

```bash
da content list [path]                    # list documents and folders
da content tree [prefix] [--ext html]     # recursively list source documents
da content get <path> [-o <file>]         # fetch source to stdout or file
da --commit content put <path> <file>     # upload document
da --commit content delete <path>         # delete document
da --commit content move <src> <dst>      # move/rename
da --commit content copy <src> <dst>      # copy
da content versions <path>               # list version history
```

EDS reads `.html` source paths. `da content put /about about.html` normalizes to `/about.html`; DA stores `/about` and `/about.html` separately.

### Local Content Workspace

Use this when an agent needs a Git-like local edit loop for DA source documents. The workspace writes files under `content/` and tracks base hashes, staged paths, and local content commits in `.da/content-state.json`.

```bash
da content clone --path /blog [--force]    # clone subtree into content/
da content clone --all                     # clone the entire site intentionally
da content status                          # added / modified / deleted, with staged marker
da content diff [path]                     # compare local content/ to current DA source
da content add [files...]                  # stage specific files, or all changed files
da content commit -m "message"             # record local content checkpoint
da content push [--path /blog]             # dry-run plan by default
da --commit content push [--path /blog]    # push committed workspace changes to DA
da content merge [path]                    # refresh local files from remote DA source
```

`content push` refuses uncommitted changes unless `--force` is passed. It still uses the global dry-run guard; root `--commit` is required for remote writes.

### Preview & Publish

```bash
da preview page <path> [--branch <b>]              # preview single page
da preview pages <source> [--concurrency N]        # batch preview from file or path prefix
da preview tree [prefix] [--verify]                # preview every HTML source document under prefix
da preview status <path>                           # check pipeline status

da --commit publish page <path>                    # publish to live CDN
da --commit publish pages <source>                 # batch publish
da --commit publish tree [prefix] [--verify-live]  # publish every HTML source document under prefix
da --commit publish unpublish <path>               # remove from live CDN
```

`preview` updates `*.aem.page`; it does not publish to `*.aem.live`. `publish` promotes already previewed output and requires `--commit`.

### Deploy (preview + publish in one step)

```bash
da --commit deploy page <path>                     # preview then publish
da --commit deploy pages <source> [--concurrency N]  # batch: previews all, publishes successes
```

### Route Management

Exit codes for `classify`: `0`=contentbus, `2`=orphan, `3`=codebus, `4`=hybrid, `5`=probe-failed.

```bash
da route classify <path>                           # probe single route ownership
da route canonical <path>                          # show source/canonical/preview/live/plain URLs
da route audit [--prefix <prefix>] [--concurrency N]  # classify all routes under prefix
da --commit route clean <path>                     # delete DA source + flush preview
```

### Index Operations

Note: `da index` has a local `--env preview|live` for query target, separate from the global DA env flag.

```bash
da index show [--file <path>]                      # print helix-query.yaml definitions
da index validate [--file <path>] [--env preview|live]  # check fields against live responses
da index query <name> [--filter k=v] [--limit N] [--offset N] [--env preview|live]
```

### Audit

```bash
da audit semantics <path>                          # heading hierarchy, metadata, link quality
da audit blocks <path>                             # block structure validation
da audit full <path>                               # all audits; exits 1 if errors found
da audit contracts [--prefix <prefix>]             # block class inventory across prefix
```

### Design Quality

```bash
da design detect <source> [--category ai-slop|quality|eds] [--severity error|warning|info]
da design audit <source> [--severity error|warning]   # all categories with fix hints
da design token-check <source>                    # verify Stardust CSS custom-property contract
da design rules [--category] [--json]             # list anti-pattern rules
```

`<source>` accepts: local HTML file path, URL, or DA path (`/my-page`).

### Migration

```bash
da --commit migrate import <url> [--path <daPath>]    # scrape URL, convert to EDS HTML, upload + preview
da --commit migrate batch <url-file> [--path-prefix <p>] [--concurrency N] [--job-id <id>]  # resumable batch
da migrate status [job-id]                        # batch job progress
da migrate validate <path>                        # full audit on imported page
```

### Pipeline (Declarative YAML DAGs)

```bash
da --commit pipeline run <yaml-file>              # execute pipeline
da pipeline status [run-id]                       # progress
da pipeline abort <run-id>                        # stop running pipeline
```

Pipeline YAML format:
```yaml
pipeline:
  name: "Deploy blog"
  context:
    org: my-org
    repo: my-site
  steps:
    - id: preview-all
      command: "preview pages /blog --concurrency 10"
    - id: publish-all
      command: "publish pages /blog --commit"
      depends_on: [preview-all]
      requires_approval: true
      timeout: 5m
```

### Code Bus

```bash
da code sync [path]                               # trigger code-bus CDN invalidation
da code status [path]                             # check sync status
da code job <jobId> [--wait] [--timeout <s>]      # poll async Helix admin job
da code sidekick get                              # print sidekick config
da --commit code sidekick set <json>             # merge JSON into sidekick config
da --commit code purge <path>                    # purge CDN cache
```

### Site Scaffolding

```bash
da site create <name> [--org] [--da-org] [--private] [--no-da]  # create EDS site (requires gh CLI)
da site list [--org] [--limit N]                # list EDS repos in org
da site info [repo] [--org] [--branch]          # pipeline health
da site doctor [repo] [--deep]                  # DA registration, source, preview/live, code-bus diagnostics
```

### Skills Management

```bash
da skills bootstrap                              # install upskill CLI to PATH
da skills install [source] [--skill <name>]      # install from GitHub/ClawHub/shorthand
da skills add <shorthand>                        # add well-known skill: impeccable|stardust|snowflake
da skills list [--global]                        # list installed skills
da skills update [name]                          # update installed skills
da skills info <name>                            # show SKILL.md frontmatter
da skills read <name>                            # print full SKILL.md
da skills search <query>                         # search across registries
```

### Stardust (4-Phase Site Redesign)

```bash
da stardust                                      # show current state and next step
da stardust extract [url] [--pages N]            # Phase 1: crawl + extract brand/content
da stardust direct [phrase]                      # Phase 2: resolve design intent → PRODUCT.md, DESIGN.md
da stardust prototype [page] [--all]             # Phase 3: generate before/after HTML prototypes
da --commit stardust migrate [page] [--all]      # Phase 4: push to DA + preview
da stardust reset                               # reset state to fresh
da stardust version                             # show local vs upstream version
da stardust update                              # sync skill from adobe/skills
```

---

## Common Workflows

Use README.md for the full user-facing command reference. When this file diverges from CLI help or README.md, treat CLI help (`da <command> --help`) as the implementation contract, then update both docs.

### Bootstrap a project

```bash
da auth login
cd /path/to/project
da config init           # sets org, repo, env in .da.json
da config show           # verify resolved config
da content list /        # confirm API connectivity
```

### Content edit cycle

```bash
da content get /index.html -o index.html
# edit index.html
da content put /index.html ./index.html          # dry-run: shows diff
da --commit content put /index.html ./index.html # commit
da --commit preview page /index                  # flush DA cache + trigger Helix pipeline
da --commit deploy page /index                   # or deploy (preview + publish in one)
```

### Local content workspace cycle

```bash
da content clone --path /
# edit files under content/
da content status
da content diff /index.html
da content add content/index.html
da content commit -m "Update homepage copy"
da content push                                  # dry-run plan
da --commit content push                         # write to DA
da preview page /index
da --commit publish page /index
```

### Audit before publishing

```bash
da audit full /index                             # exits 1 if errors found
da design audit /index --severity error          # fail on design errors only
```

### Clean up orphaned routes

```bash
da route audit --prefix /deprecated             # classify all routes
da route classify /deprecated/old-page          # check a single one
da --commit route clean /deprecated/old-page    # delete + flush
```

### Batch deploy with concurrency

```bash
da preview pages /blog --concurrency 20
da --commit publish pages /blog --concurrency 10
```

---

## API Base URLs

| Env | DA Admin | Helix Admin |
|---|---|---|
| `prod` | `https://admin.da.live` | `https://admin.hlx.page` |
| `stage` | `https://stage-admin.da.live` | `https://admin.hlx.page` |
| `dev` | `https://stage-admin.da.live` | `https://admin.hlx.page` |

Rendered preview URLs follow the pattern:
```
https://{branch}--{repo}--{org}.aem.page{path}.plain.html
```

---

## Error Handling

| HTTP Status | Meaning | Action |
|---|---|---|
| 401 | Unauthorized | Run `da auth login` |
| 404 | Not found | Check path and org/repo config |
| 5xx | API error | Retry; check `--verbose` for details |

Use `--verbose` to print full request/response details for debugging.
