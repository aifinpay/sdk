// ──────────────────────────────────────────────────────────────────────────
// Reference x402-gated API service.
//
// Charges autonomous AI agents per call using the AiFinPay protocol. The
// service does NOT need its own wallet, blockchain RPC, or KYC layer —
// it leans on AiFinPay for identity (Seat PDA) and payment proof.
//
// Wire flow:
//   1. agent → GET /echo (no auth)            ↵
//   2. server → 402 + manifest + fresh nonce  ↵
//   3. agent  → signs SHA-256("AiFinPay-x402:{nonce}:{pubkey}")  ↵
//   4. agent  → GET /echo with x-agent-pubkey, x-nonce, x-signature  ↵
//   5. server verifies sig, queries AiFinPay /api/seat/:pubkey,
//      → 200 if Seat is live; 402 otherwise.
//
// Run:
//   AIFINPAY_API=https://aifinpay.io PORT=3000 node server.js
// ──────────────────────────────────────────────────────────────────────────
import crypto from "node:crypto";
import express from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";

const PORT          = process.env.PORT          || 3000;
const AIFINPAY_API  = process.env.AIFINPAY_API  || "https://aifinpay.io";
const PRICE_USD     = process.env.PRICE_USD     || "0.001";
const SERVICE_NAME  = process.env.SERVICE_NAME  || "echo-x402";

// SHA-256 of the canonical AiFinPay agreement document v5.3 — agents
// verify this matches the manifesto they signed off on.
const MANIFESTO_HASH =
  "27b28e3044b56df3332a60c27604686a634f922a184f62398a4e2f85df19c699";

const NONCE_TTL_MS = 60_000;
const nonces = new Map(); // nonce -> expiresAt (epoch ms)

function issueNonce() {
  const n = crypto.randomUUID();
  nonces.set(n, Date.now() + NONCE_TTL_MS);
  // Lazy GC.
  if (nonces.size > 10_000) {
    const now = Date.now();
    for (const [k, exp] of nonces) if (exp < now) nonces.delete(k);
  }
  return n;
}

function consumeNonce(n) {
  const exp = nonces.get(n);
  if (!exp || exp < Date.now()) return false;
  nonces.delete(n);
  return true;
}

function verifySignature(pubkeyB58, nonce, sigB58) {
  try {
    const msg = new TextEncoder().encode(
      `AiFinPay-x402:${nonce}:${pubkeyB58}`,
    );
    const digest = crypto.createHash("sha256").update(msg).digest();
    return nacl.sign.detached.verify(
      digest,
      bs58.decode(sigB58),
      bs58.decode(pubkeyB58),
    );
  } catch {
    return false;
  }
}

async function agentHasSeat(pubkey) {
  try {
    const r = await fetch(`${AIFINPAY_API}/api/seat/${pubkey}`);
    if (!r.ok) return false;
    const j = await r.json();
    return Boolean(j.has_seat);
  } catch {
    return false;
  }
}

function challenge402(res, message = "Payment Required") {
  const nonce = issueNonce();
  return res.status(402).json({
    error: message,
    protocol: "AiFinPay v5.3",
    service: SERVICE_NAME,
    manifesto: `${AIFINPAY_API}/manifesto.json`,
    treasury_vault: "AnbjcK3uD5KYFtb3EuUxHTyJMfC4oyLo7hF2uELfKagN",
    agreement_hash: MANIFESTO_HASH,
    "x-nonce": nonce,
    "x-nonce-expires": new Date(Date.now() + NONCE_TTL_MS).toISOString(),
    price_usd: PRICE_USD,
    instructions: [
      "1. Reserve a Seat PDA at https://aifinpay.io",
      `2. Sign SHA-256("AiFinPay-x402:${nonce}:<your_pubkey>") with Ed25519`,
      "3. Resend with x-agent-pubkey + x-nonce + x-signature headers",
    ],
  });
}

// ── x402 middleware ──────────────────────────────────────────────────────
async function x402Gate(req, res, next) {
  const pubkey = req.header("x-agent-pubkey");
  const nonce  = req.header("x-nonce");
  const sig    = req.header("x-signature");

  if (!pubkey || !nonce || !sig) {
    return challenge402(res);
  }
  if (!consumeNonce(nonce)) {
    return challenge402(res, "Invalid or expired nonce");
  }
  if (!verifySignature(pubkey, nonce, sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }
  if (!(await agentHasSeat(pubkey))) {
    return challenge402(
      res,
      `No Seat PDA found for ${pubkey} — reserve one at AiFinPay first`,
    );
  }
  req.agentPubkey = pubkey;
  next();
}

// ── App ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));

// Open endpoints (no payment) — discovery + nonce.
app.get("/", (_req, res) =>
  res.json({
    service: SERVICE_NAME,
    description: "Reference x402-gated API. Try GET /echo",
    aifinpay: AIFINPAY_API,
  }),
);

app.get("/.well-known/x402.json", (_req, res) =>
  res.json({
    protocol: "AiFinPay v5.3",
    facilitator: "aifinpay",
    manifesto: `${AIFINPAY_API}/manifesto.json`,
    price_usd: PRICE_USD,
    paid_endpoints: ["/echo"],
  }),
);

app.get("/nonce", (_req, res) => {
  const n = issueNonce();
  res.json({
    nonce: n,
    expires_at: new Date(Date.now() + NONCE_TTL_MS).toISOString(),
  });
});

// Paid endpoint.
app.get("/echo", x402Gate, (req, res) => {
  res.json({
    service: SERVICE_NAME,
    paid_by: req.agentPubkey,
    message: req.query.message || "hello, autonomous agent",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] x402-gated API on port ${PORT}`);
  console.log(`  Verifying Seats against ${AIFINPAY_API}`);
  console.log(`  Try: curl http://localhost:${PORT}/echo`);
});
