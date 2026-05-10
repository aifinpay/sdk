#!/usr/bin/env node
// Generate a fresh Polygon EOA for the test agent.
//
// Usage:
//   node gen-test-wallet.js
//
// Output is a single-use disposable wallet for piloting the bridge demo.
// Fund it with ~0.05 MATIC and put the private key in AGENT_PRIVATE_KEY.
//
// IMPORTANT: do NOT use this script for wallets that hold real revenue.
// Stdout is not a vault. For production use a hardware wallet, MetaMask
// (BIP-39 seed you control), or a Safe.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("");
console.log("─── Polygon test agent wallet ────────────────────────────────");
console.log("address:     " + account.address);
console.log("private_key: " + privateKey);
console.log("");
console.log("Next steps:");
console.log("  1. Fund " + account.address + " with ~0.05 MATIC on Polygon");
console.log("     (e.g. send from MetaMask, or any centralized exchange withdrawal).");
console.log("  2. export AGENT_PRIVATE_KEY=" + privateKey);
console.log("  3. node test-client.js \"your search query\"");
console.log("");
console.log("Polygonscan:  https://polygonscan.com/address/" + account.address);
console.log("");
console.log("⚠  Disposable demo wallet only. Do not deposit real funds beyond what");
console.log("   the pilot needs. The private key was printed to stdout — assume the");
console.log("   shell history, scrollback, and clipboard now know about it.");
console.log("");
