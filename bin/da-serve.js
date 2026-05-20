#!/usr/bin/env node
import { createServer } from '../src/server/index.js';

const PORT = parseInt(process.env.PORT || '3402', 10);
const HOST = process.env.HOST || '127.0.0.1';
const addr = process.env.X402_WALLET_ADDRESS;
const network = process.env.X402_NETWORK || 'eip155:84532';
const x402Enabled = parseX402Flag(process.argv.slice(2));
const paymentEnabled = x402Enabled && !!addr;

// Refuse network-exposed startup without payment gating.
// Without X402_WALLET_ADDRESS, all paid routes are unprotected — that would
// expose the operator's DA token to unauthenticated callers on the network.
const isLoopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
if (!isLoopback && !paymentEnabled) {
  console.error('ERROR: Refusing to bind to non-loopback address without x402 payment gating.');
  console.error('  Set X402_WALLET_ADDRESS and leave x402 enabled, or bind to 127.0.0.1 (default).');
  process.exit(1);
}

if (x402Enabled && !addr) {
  console.error('ERROR: x402 is enabled but X402_WALLET_ADDRESS is not set.');
  console.error('  Set X402_WALLET_ADDRESS, pass --no-x402 for loopback development, or set X402_ENABLED=false.');
  process.exit(1);
}

const app = createServer({ x402Enabled });

app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`\nda-serve running at ${base}`);
  console.log(`  Agent card : ${base}/.well-known/x402`);
  console.log(`  Health     : ${base}/v1/health`);

  if (paymentEnabled) {
    console.log(`\nx402 payments active`);
    console.log(`  Wallet      : ${addr}`);
    console.log(`  Network     : ${network}`);
    console.log(`  Facilitator : ${process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator'}`);
  } else {
    console.log('\nx402 payments DISABLED (loopback-only)');
  }

  const daToken = `${process.env.HOME || '~'}/.aem/da-token.json`;
  console.log(`\nDA auth token : ${daToken} (run \`da auth login\` if missing)`);
});

function parseX402Flag(args) {
  let enabled = process.env.X402_ENABLED !== 'false';
  for (const arg of args) {
    if (arg === '--x402') enabled = true;
    else if (arg === '--no-x402') enabled = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: da-serve [--x402|--no-x402]\n\nOptions:\n  --x402     Require x402 payment gating (default unless X402_ENABLED=false)\n  --no-x402  Disable x402 payment gating for loopback development`);
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return enabled;
}
