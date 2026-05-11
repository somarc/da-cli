import { Command } from 'commander';
import { resolveConfig, getConfigValue, setConfigValue, initConfig, globalConfigPath, projectConfigFile } from '../lib/config.js';

export function makeConfigCommand() {
  const config = new Command('config').description('Manage DA CLI configuration');

  config
    .command('init')
    .description('Interactive setup: org, repo, env — writes to .da.json in current directory')
    .option('--global', 'Write to ~/.da/config.json instead of project .da.json')
    .action(async (opts) => {
      try {
        const written = await initConfig({ global: opts.global });
        console.log(`Config written to ${written}`);
      } catch (err) {
        if (err.code === 'ERR_USE_AFTER_CLOSE') {
          // stdin closed (non-interactive) — just show help
          console.error('stdin is not interactive. Use `da config set` to write values directly.');
        } else {
          console.error(err.message);
        }
        process.exit(1);
      }
    });

  config
    .command('get <key>')
    .description('Print a single resolved config value')
    .action(async (key) => {
      const value = await getConfigValue(key);
      if (value === undefined) {
        console.error(`Key "${key}" not set`);
        process.exit(1);
      }
      console.log(value);
    });

  config
    .command('set <key> <value>')
    .description('Set a config value in project .da.json (or global with --global)')
    .option('--global', 'Write to ~/.da/config.json')
    .action(async (key, value, opts) => {
      const written = await setConfigValue(key, value, { global: opts.global });
      console.log(`Set ${key}=${value} in ${written}`);
    });

  config
    .command('show')
    .description('Print full resolved config with source annotation (flag / project / global / default)')
    .option('--org <org>', 'Override org for this resolution')
    .option('--repo <repo>', 'Override repo for this resolution')
    .option('--env <env>', 'Override env for this resolution')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const resolved = await resolveConfig({ org: opts.org, repo: opts.repo, env: opts.env });

      if (opts.json) {
        console.log(JSON.stringify(resolved, null, 2));
        return;
      }

      const padKey = (s) => s.padEnd(8);
      const fmt = (key) => {
        const val = resolved.config[key] ?? '(unset)';
        const src = resolved.sources[key] ?? '';
        return `  ${padKey(key)}  ${String(val).padEnd(30)}  [${src}]`;
      };

      console.log('Resolved config:');
      console.log(fmt('org'));
      console.log(fmt('repo'));
      console.log(fmt('env'));

      for (const [key, val] of Object.entries(resolved.config)) {
        if (['org', 'repo', 'env'].includes(key)) continue;
        console.log(`  ${padKey(key)}  ${String(val)}`);
      }

      console.log('');
      console.log(`Project config: ${projectConfigFile()} (searched upward from cwd)`);
      console.log(`Global config:  ${globalConfigPath()}`);
    });

  return config;
}
