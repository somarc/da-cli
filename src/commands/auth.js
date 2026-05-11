import { Command } from 'commander';
import { getToken, clearToken, tokenStatus, tokenPath } from '../lib/auth.js';

export function makeAuthCommand() {
  const auth = new Command('auth').description('Authenticate with Adobe IMS');

  auth
    .command('login')
    .description('Obtain and cache a DA Bearer token via da-auth-helper')
    .option('--refresh', 'Force re-auth even if cached token is still valid')
    .action(async (opts) => {
      try {
        const token = await getToken({ refresh: opts.refresh });
        console.log(`Authenticated. Token cached at ${tokenPath()}`);
        console.log(`Bearer ${token.slice(0, 20)}…`);
      } catch (err) {
        console.error(`Auth failed: ${err.message}`);
        process.exit(1);
      }
    });

  auth
    .command('logout')
    .description('Remove cached token')
    .action(async () => {
      const cleared = await clearToken();
      if (cleared) {
        console.log('Token removed.');
      } else {
        console.log('No cached token found.');
      }
    });

  auth
    .command('status')
    .description('Show token validity and expiry')
    .action(async () => {
      const status = await tokenStatus();
      if (status.valid) {
        const exp = new Date(status.expires_at).toLocaleString();
        const mins = Math.round(status.remaining_ms / 60_000);
        console.log(`valid  expires ${exp}  (~${mins} min remaining)`);
      } else {
        console.log(`invalid  ${status.reason}`);
        process.exit(1);
      }
    });

  auth
    .command('token')
    .description('Print raw Bearer token to stdout (pipe to curl or env vars)')
    .option('--refresh', 'Force re-auth before printing')
    .action(async (opts) => {
      try {
        const token = await getToken({ refresh: opts.refresh });
        process.stdout.write(token);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
    });

  return auth;
}
