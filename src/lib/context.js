// Module-level singleton populated by the root program's preAction hook.
// Any lib or command reads getGlobals() instead of walking commander's
// parent chain, which breaks for nested subcommands.
let _globals = {
  org: undefined,
  repo: undefined,
  env: undefined,
  format: undefined,
  dryRun: false,
  commit: false,
  quiet: false,
  verbose: false,
};

export function setGlobals(opts) {
  _globals = { ..._globals, ...opts };
}

export function getGlobals() {
  return _globals;
}
