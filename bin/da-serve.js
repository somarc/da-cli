#!/usr/bin/env node
import { createServer } from '../src/server/index.js';

const PORT = parseInt(process.env.PORT || '3402', 10);
const HOST = process.env.HOST || '127.0.0.1';
const addr = process.env.X402_WALLET_ADDRESS;
const network = process.env.X402_NETWORK || 'base';

// Refuse network-exposed startup without payment gating.
// Without X402_WALLET_ADDRESS, all paid routes are unprotected — that would
// expose the operator's DA token to unauthenticated callers on the network.
const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
if (!isLoopback && !addr) {
  console.error('ERROR: Refusing to bind to non-loopback address without X402_WALLET_ADDRESS.');
  console.error('  Set X402_WALLET_ADDRESS to enable payment gating, or bind to 127.0.0.1 (default).');
  process.exit(1);
}

const app = createServer();

app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`\nda-serve running at ${base}`);
  console.log(`  Agent card : ${base}/.well-known/x402`);
  console.log(`  Health     : ${base}/v1/health`);

  if (addr) {
    console.log(`\nx402 payments active`);
    console.log(`  Wallet      : ${addr}`);
    console.log(`  Network     : ${network}`);
    console.log(`  Facilitator : ${process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'}`);
  } else {
    console.log('\nx402 payments DISABLED (loopback-only — set X402_WALLET_ADDRESS to expose to network)');
  }

  const daToken = `${process.env.HOME || '~'}/.aem/da-token.json`;
  console.log(`\nDA auth token : ${daToken} (run \`da auth login\` if missing)`);
});
