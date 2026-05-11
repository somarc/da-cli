import { Command } from 'commander';
import { setGlobals } from './lib/context.js';
import { makeAuthCommand } from './commands/auth.js';
import { makeConfigCommand } from './commands/config.js';
import { makeContentCommand } from './commands/content.js';

const program = new Command();

program
  .name('da')
  .description('CLI for Adobe Edge Delivery Services via DA Admin API')
  .version('0.1.0');

program
  .option('--org <org>', 'DA org (overrides .da.json and ~/.da/config.json)')
  .option('--repo <repo>', 'DA repo')
  .option('--env <env>', 'Environment: dev | stage | prod (default: prod)')
  .option('--format <fmt>', 'Output format: table | json | md (default: table)')
  .option('--dry-run', 'Show what would happen without mutating')
  .option('--commit', 'Execute mutations (required to override dry-run default on writes)')
  .option('--quiet', 'Suppress progress output, print only results')
  .option('--verbose', 'Print full request/response details');

// Populate the context singleton before any subcommand runs so every
// lib function sees root flags without walking the commander parent chain.
program.hook('preAction', (rootCmd) => {
  setGlobals(rootCmd.opts());
});

program.addCommand(makeAuthCommand());
program.addCommand(makeConfigCommand());
program.addCommand(makeContentCommand());

program.parseAsync(process.argv);
