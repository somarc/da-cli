import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { setGlobals } from './lib/context.js';
import { loadDotEnv } from './lib/config.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
import { makeAuthCommand } from './commands/auth.js';
import { makeConfigCommand } from './commands/config.js';
import { makeContentCommand } from './commands/content.js';
import { makePreviewCommand } from './commands/preview.js';
import { makePublishCommand } from './commands/publish.js';
import { makeDeployCommand } from './commands/deploy.js';
import { makeRouteCommand } from './commands/route.js';
import { makeIndexCommand } from './commands/index.js';
import { makeAuditCommand } from './commands/audit.js';
import { makeMigrateCommand } from './commands/migrate.js';
import { makePipelineCommand } from './commands/pipeline.js';
import { makeCodeCommand } from './commands/code.js';
import { makeDesignCommand } from './commands/design.js';
import { makeStardustCommand } from './commands/stardust.js';
import { makeSiteCommand } from './commands/site.js';
import { makeSkillsCommand } from './commands/skills.js';

const program = new Command();

loadDotEnv();

program
  .name('da')
  .description('CLI for Adobe Edge Delivery Services via DA Admin API')
  .version(version);

program
  .option('--org <org>', 'DA org (overrides .da.json and ~/.da/config.json)')
  .option('--repo <repo>', 'DA repo')
  .option('--env <env>', 'Environment: dev | stage | prod (default: prod)')
  .option('--format <fmt>', 'Output format: table | json | md (default: table)')
  .option('--log-level <level>', 'Log level: silent | error | warn | info | debug', process.env.DA_LOG_LEVEL ?? process.env.AEM_LOG_LEVEL ?? 'info')
  .option('--log-file <file>', 'Append logs to file instead of stderr')
  .option('--request-id <id>', 'Request correlation ID sent as x-request-id')
  .option('--dry-run', 'Show what would happen without mutating')
  .option('--commit', 'Execute mutations (required to override dry-run default on writes)')
  .option('--quiet', 'Suppress progress output, print only results')
  .option('--verbose', 'Print full request/response details');

// Populate the context singleton before any subcommand runs so every
// lib function sees root flags without walking the commander parent chain.
program.hook('preAction', (rootCmd) => {
  const opts = rootCmd.opts();
  setGlobals({
    ...opts,
    format: opts.format ?? process.env.DA_FORMAT ?? process.env.AEM_FORMAT,
    logFile: opts.logFile ?? process.env.DA_LOG_FILE ?? process.env.AEM_LOG_FILE,
    requestId: opts.requestId ?? process.env.DA_REQUEST_ID ?? process.env.AEM_REQUEST_ID,
  });
});

program.addCommand(makeAuthCommand());
program.addCommand(makeConfigCommand());
program.addCommand(makeContentCommand());
program.addCommand(makePreviewCommand());
program.addCommand(makePublishCommand());
program.addCommand(makeDeployCommand());
program.addCommand(makeRouteCommand());
program.addCommand(makeIndexCommand());
program.addCommand(makeAuditCommand());
program.addCommand(makeMigrateCommand());
program.addCommand(makePipelineCommand());
program.addCommand(makeCodeCommand());
program.addCommand(makeDesignCommand());
program.addCommand(makeStardustCommand());
program.addCommand(makeSiteCommand());
program.addCommand(makeSkillsCommand());

program.parseAsync(process.argv);
