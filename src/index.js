import { Command } from 'commander';
import { makeAuthCommand } from './commands/auth.js';
import { makeConfigCommand } from './commands/config.js';

const program = new Command();

program
  .name('da')
  .description('CLI for Adobe Edge Delivery Services via DA Admin API')
  .version('0.1.0');

// Global flags — resolved by lib/config.js resolveConfig()
program
  .option('--org <org>', 'DA org (overrides .da.json and ~/.da/config.json)')
  .option('--repo <repo>', 'DA repo')
  .option('--env <env>', 'Environment: dev | stage | prod (default: prod)')
  .option('--format <fmt>', 'Output format: table | json | md (default: table)')
  .option('--dry-run', 'Show what would happen without mutating')
  .option('--commit', 'Execute mutations (required to override dry-run default on writes)')
  .option('--quiet', 'Suppress progress output, print only results')
  .option('--verbose', 'Print full request/response details');

program.addCommand(makeAuthCommand());
program.addCommand(makeConfigCommand());

program.parseAsync(process.argv);
