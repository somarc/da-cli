# DA-MUX CMUX Workspace Experiment

This is the DA CLI-specific version of the CMUX-inspired DA/EDS workspace.

The goal is to make `da` workflows feel native inside CMUX: project context, authentication, content discovery, route ownership, site health, audits, preview, and agent work lanes in one workspace.

## What is included

- `.cmux/cmux.json` adds a project-local **DA CLI Workspace** for developing this CLI repo.
- `templates/cmux/da-cli/cmux.json` is a reusable **DA Workspace** template for DA/EDS project repos that use the installed `da` binary.
- The workspace opens:
  - context/auth lane
  - content discovery lane
  - route/site/audit/design checks
  - preview/deploy dry-run lane
  - agent lane

## Safety model

The DA CLI already makes write operations dry-run by default. The CMUX recipe preserves that model:

- Read-only commands are surfaced directly.
- Dry-run commands are safe to explore.
- `--commit` remains a manual approval step.
- Publish, purge, migrate, site creation, and remote content mutations should not be run by an agent without explicit approval.

## Try it in this repo

Open this repository in CMUX. The project-local `.cmux/cmux.json` should add **DA CLI Workspace** to the new workspace action and command palette.

The workspace uses the local source checkout:

```bash
node bin/da.js config show
node bin/da.js auth status
node bin/da.js content tree / --ext html
node bin/da.js site doctor
```

## Try it in a DA/EDS project repo

Copy the reusable template into the project:

```bash
mkdir -p .cmux
cp /Users/mhess/aem/aem-code/da/da-cli/templates/cmux/da-cli/cmux.json .cmux/cmux.json
```

Then open the project in CMUX and run **DA Workspace** from the command palette or new workspace menu.

## Product direction

This file-based recipe is the first prove-out. The next step should be a `da cmux init` or `da workspace init` command that writes the template into the current project and can tune defaults such as preview path, audit path, branch, preferred agent, and whether browser preview panes should be included.

Longer term, this maps into the FluffyJaws workspace model:

- DA context and auth posture
- content tree and route ownership state
- local repo and terminal sessions
- preview/live URLs
- audit and design findings
- agent work lanes
- explicit approval gates for external writes
- workspace memory attached to the project
