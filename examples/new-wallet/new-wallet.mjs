#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// new-wallet — generate a fresh EVM keypair for an autonomous agent.
//
// Non-custodial: the private key never leaves this process. Save it
// somewhere safe (env var, password manager, hardware-backed secret store)
// and use it as `AGENT_PK` when initialising AiFinPayAgent.
//
// Usage:
//   node examples/new-wallet/new-wallet.mjs
//
// Output (one line each):
//   address:     0x...
//   privateKey:  0x...
//
// You can also one-shot it without cloning the repo:
//   node -e "import('viem/accounts').then(({generatePrivateKey, privateKeyToAccount}) => {
//     const pk = generatePrivateKey();
//     console.log('address:', privateKeyToAccount(pk).address);
//     console.log('privateKey:', pk);
//   });"
// ─────────────────────────────────────────────────────────────────────────────
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = generatePrivateKey();
const acc = privateKeyToAccount(pk);

process.stdout.write("AiFinPay agent wallet — generated locally, never sent over the network.\n");
process.stdout.write("─".repeat(72) + "\n");
process.stdout.write(`address:     ${acc.address}\n`);
process.stdout.write(`privateKey:  ${pk}\n`);
process.stdout.write("─".repeat(72) + "\n");
process.stdout.write("\n");
process.stdout.write("Next steps:\n");
process.stdout.write("  1. Save the privateKey somewhere safe (e.g. AGENT_PK env var).\n");
process.stdout.write("  2. Fund the address with ~0.5 POL on Polygon (≈ $0.05) to cover a few calls.\n");
process.stdout.write("  3. Register the address at https://dashboard.aifinpay.io/partners\n");
process.stdout.write("     so on-chain activity rolls up in your workspace.\n");
process.stdout.write("  4. Run your agent — `new AiFinPayAgent({privateKey: process.env.AGENT_PK})`\n");
process.stdout.write("     then `agent.call({provider:\"io-net\", body:{...}})`.\n");
