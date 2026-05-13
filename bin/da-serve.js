#!/usr/bin/env node
import { createServer } from '../src/server/index.js';

const PORT = parseInt(process.env.PORT || '3402', 10);
const app = createServer();

app.listen(PORT, () => {
  const addr = process.env.X402_WALLET_ADDRESS;
  const network = process.env.X402_NETWORK || 'base';
  const base = `http://localhost:${PORT}`;

  console.log(`\nda-serve running at ${base}`);
  console.log(`  Agent card : ${base}/.well-known/x402`);
  console.log(`  Health     : ${base}/v1/health`);

  if (addr) {
    console.log(`\nx402 payments active`);
    console.log(`  Wallet  : ${addr}`);
    console.log(`  Network : ${network}`);
    console.log(`  Facilitator: ${process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'}`);
  } else {
    console.log('\nx402 payments DISABLED — set X402_WALLET_ADDRESS to enable');
  }

  const daAuth = process.env.HOME ? `${process.env.HOME}/.aem/da-token.json` : '~/.aem/da-token.json';
  console.log(`\nDA auth token: ${daAuth} (run \`da auth login\` if missing)`);
});
