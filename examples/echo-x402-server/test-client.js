// ──────────────────────────────────────────────────────────────────────────
// Demo client — shows what an autonomous agent sees when calling the
// echo server. Two paths:
//   (1) raw fetch — proves the wire protocol from first principles.
//   (2) AiFinPay SDK — same flow, one line.
//
// Run after `npm install`:
//   ECHO_URL=http://localhost:3000/echo node test-client.js
//
// Note: the agent must already have a funded Seat PDA at AiFinPay for
// the 200 path to succeed. If it doesn't, both paths will see 402
// (which is correct — that's exactly what the protocol promises).
// ──────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { Agent } from "@aifinpay/agent";

const ECHO_URL =
  process.env.ECHO_URL || "http://localhost:3000/echo?message=hi";

// ── Path 1: raw fetch with manual signature ───────────────────────────────
async function payRawly() {
  console.log("\n[raw fetch path]");
  const kp = nacl.sign.keyPair();
  const pubkeyB58 = bs58.encode(kp.publicKey);

  // 1. Probe.
  let r = await fetch(ECHO_URL);
  console.log(`  probe → ${r.status}`);
  const challenge = await r.json();
  console.log(`  challenge.x-nonce = ${challenge["x-nonce"]?.slice(0, 8)}…`);

  // 2. Sign challenge.
  const msg = new TextEncoder().encode(
    `AiFinPay-x402:${challenge["x-nonce"]}:${pubkeyB58}`,
  );
  const digest = crypto.createHash("sha256").update(msg).digest();
  const sig = nacl.sign.detached(digest, kp.secretKey);

  // 3. Retry.
  r = await fetch(ECHO_URL, {
    headers: {
      "x-agent-pubkey": pubkeyB58,
      "x-nonce": challenge["x-nonce"],
      "x-signature": bs58.encode(sig),
    },
  });
  const body = await r.text();
  console.log(`  retry → ${r.status} ${body.slice(0, 120)}`);
}

// ── Path 2: AiFinPay SDK (one line of payment code) ───────────────────────
async function paySDK() {
  console.log("\n[SDK path — agent.pay()]");
  const agent = Agent.new();
  console.log(`  agent address: ${agent.address.slice(0, 16)}…`);

  try {
    const resp = await agent.pay(ECHO_URL);
    const body = await resp.text();
    console.log(`  pay() → ${resp.status} ${body.slice(0, 120)}`);
  } catch (e) {
    console.log(`  pay() raised ${e.constructor.name}: ${e.message}`);
  }
}

await payRawly();
await paySDK();
