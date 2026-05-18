// ──────────────────────────────────────────────────────────────────────────
// gcore-x402-bridge — paid-proxy in front of Gcore Everywhere Inference
// (managed LLM inference on Gcore's GPU pool).
//
// Same Polygon-pilot pattern as exa- and venice-x402-bridge: agent calls
// B2BSplitter.payMatic(merchant, address(0), orderId), bridge verifies
// the receipt and forwards the request to api.intelligence.io.solutions
// using the bridge operator's pooled API key.
//
// Everywhere Inference is OpenAI-compatible — drop in chat-completions body
// with model + messages and it works. Auth: Bearer token by default;
// override with GCORE_AUTH_SCHEME=x-api-key if your key requires that.
//
// Run:
//   GCORE_API_KEY=... \
//   BRIDGE_MERCHANT_WALLET=0x... \
//   PORT=3003 \
//   node server.js
// ──────────────────────────────────────────────────────────────────────────
import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import {
  createPublicClient,
  http,
  parseEventLogs,
  getAddress,
  isAddress,
} from "viem";
import { polygon } from "viem/chains";
import {
  putOrder,
  hasOrder,
  consumeOrder,
  isTxConsumed,
  markTxConsumed,
} from "./store.js";

const PORT                   = process.env.PORT                   || 3004;
const SERVICE_NAME           = process.env.SERVICE_NAME           || "gcore-x402-bridge";
// Operator pre-provisions a Gcore Everywhere Inference deployment (e.g.
// Llama-3.3-70B) and pastes its `endpoint_url` here, with the OpenAI-
// compatible /v1/chat/completions path appended.
// Example: https://<deploy>.inference.<region>.gcore.cloud/v1/chat/completions
const GCORE_API_URL          = process.env.GCORE_API_URL          || "";
const GCORE_API_KEY          = process.env.GCORE_API_KEY          || "";
// Gcore convention: `Authorization: APIKey <token>`. Override to "bearer" or
// "x-api-key" if your deployment exposes an OpenAI-style endpoint with a
// different scheme.
const GCORE_AUTH_SCHEME      = process.env.GCORE_AUTH_SCHEME      || "apikey";
const POLYGON_RPC            = process.env.POLYGON_RPC            || "https://1rpc.io/matic";
const SPLITTER_ADDRESS       = process.env.SPLITTER_ADDRESS_POLYGON
                            || "0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440";
const BRIDGE_MERCHANT_WALLET = process.env.BRIDGE_MERCHANT_WALLET || "";
// Default 0.25 POL (~$0.025) per inference call. Everywhere Inference per-token
// pricing on llama-3-70B ≈ $0.001-0.005 per typical agent call — leaves
// 5-20× margin on the bridge. Adjust to match the model you route most.
const PRICE_WEI              = process.env.PRICE_WEI              || "250000000000000000";
const ORDER_TTL_MS           = 10 * 60_000;

// ── Stablecoin pricing (v5.3 B2BSplitter.payStable path) ────────────────
// USD-cent denominated price for USDC / USDT settlement. 6-decimal units
// match the on-chain ERC-20 contract. 25_000 units = $0.025 USDC.
const PRICE_USDC_UNITS       = process.env.PRICE_USDC_UNITS       || "25000";
const PRICE_USDT_UNITS       = process.env.PRICE_USDT_UNITS       || "25000";
const USDC_ADDRESS           = process.env.USDC_POLYGON           || "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDT_ADDRESS           = process.env.USDT_POLYGON           || "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
// Standard x402 facilitator URL — Polygon's x402-rs deployment. The
// Polygon agent-cli reads `accepts[]` from our 402 and POSTs `x-payment`
// header to this facilitator's /verify + /settle endpoints to complete
// the transferWithAuthorization (ERC-3009) flow without the agent
// broadcasting a tx themselves.
const X402_FACILITATOR_URL   = process.env.X402_FACILITATOR_URL   || "https://x402.polygon.technology";
const X402_RESOURCE_URL      = process.env.X402_RESOURCE_URL      || "https://bridge.aifinpay.company/gcore/chat/completions";

if (!GCORE_API_URL) {
  console.error(`[${SERVICE_NAME}] FATAL: GCORE_API_URL not set. Provision an Inference deployment in Gcore Cloud and paste its endpoint URL (with /v1/chat/completions appended).`);
  process.exit(1);
}
if (!GCORE_API_KEY) {
  console.warn(`[${SERVICE_NAME}] WARNING: GCORE_API_KEY not set — upstream calls will 401.`);
}
if (!isAddress(BRIDGE_MERCHANT_WALLET)) {
  console.error(`[${SERVICE_NAME}] FATAL: BRIDGE_MERCHANT_WALLET is not a valid 0x address.`);
  process.exit(1);
}

const SPLITTER_EVENT_ABI = [{
  type: "event",
  name: "Payment",
  inputs: [
    { type: "address", name: "payer",            indexed: true  },
    { type: "address", name: "merchant",         indexed: true  },
    { type: "address", name: "token",            indexed: true  },
    { type: "uint256", name: "totalAmount",      indexed: false },
    { type: "uint256", name: "merchantAmount",   indexed: false },
    { type: "uint256", name: "treasuryAmount",   indexed: false },
    { type: "uint256", name: "ipCreatorAmount",  indexed: false },
    { type: "string",  name: "orderId",          indexed: false },
  ],
}];

const client = createPublicClient({ chain: polygon, transport: http(POLYGON_RPC) });

function issueOrderId() {
  return `gcore-${crypto.randomUUID().slice(0, 18)}`;
}

async function challenge402(res) {
  const orderId = issueOrderId();
  await putOrder(orderId, "");
  const totalWei = BigInt(PRICE_WEI);
  const treasuryAmt = (totalWei * 100n) / 10000n;
  const ipAmt       = (totalWei * 1n)   / 10000n;
  const merchantAmt = totalWei - treasuryAmt - ipAmt;

  // USDC/USDT totals — same BPS, 6-decimal units.
  const stableTotal = (units) => {
    const t = BigInt(units);
    return {
      total:         t.toString(),
      merchant:      (t - (t * 100n) / 10000n - (t * 1n) / 10000n).toString(),
      treasury:      ((t * 100n) / 10000n).toString(),
      ip_creator:    ((t * 1n)   / 10000n).toString(),
    };
  };
  const usdc = stableTotal(PRICE_USDC_UNITS);
  const usdt = stableTotal(PRICE_USDT_UNITS);

  return res.status(402).json({
    error: "Payment Required",
    protocol: "AiFinPay v5.3",
    service: SERVICE_NAME,

    // ── Standard x402 path (Polygon facilitator, ERC-3009 USDC/USDT) ────
    // Polygon agent-cli and any other x402-compliant client reads this
    // accepts[] array and POSTs an x-payment header on retry. Bridge
    // verifies via X402_FACILITATOR_URL's /verify + /settle endpoints.
    x402Version: 1,
    accepts: [
      {
        scheme:            "erc-3009",
        network:           "polygon",
        token:             USDC_ADDRESS,
        maxAmountRequired: usdc.total,
        resource:          X402_RESOURCE_URL,
        description:       "Gcore Llama-3.3-70B inference (1 call)",
        mimeType:          "application/json",
        payTo:             BRIDGE_MERCHANT_WALLET,
        maxTimeoutSeconds: Math.floor(ORDER_TTL_MS / 1000),
        extra:             { name: "USD Coin", version: "2", facilitator: X402_FACILITATOR_URL },
      },
      {
        scheme:            "erc-3009",
        network:           "polygon",
        token:             USDT_ADDRESS,
        maxAmountRequired: usdt.total,
        resource:          X402_RESOURCE_URL,
        description:       "Gcore Llama-3.3-70B inference (1 call)",
        mimeType:          "application/json",
        payTo:             BRIDGE_MERCHANT_WALLET,
        maxTimeoutSeconds: Math.floor(ORDER_TTL_MS / 1000),
        extra:             { name: "Tether USD", version: "1", facilitator: X402_FACILITATOR_URL },
      },
    ],
    error_code: "Payment Required",

    // ── Legacy AiFinPay-pay-matic path (native POL via B2BSplitter) ─────
    // Power-user clients (our own SDK) that want atomic POL split call
    // this directly without facilitator overhead. Stays backward-compat
    // with v0.2.x of @aifinpay/agent.
    facilitator: "aifinpay-pay-matic",
    pay_matic: {
      chain:                 "polygon",
      splitter:              SPLITTER_ADDRESS,
      merchant_wallet:       BRIDGE_MERCHANT_WALLET,
      total_wei:             totalWei.toString(),
      merchant_amount_wei:   merchantAmt.toString(),
      treasury_amount_wei:   treasuryAmt.toString(),
      ip_creator_amount_wei: ipAmt.toString(),
      order_id:              orderId,
      function_signature:    "payMatic(address,address,string)",
      ttl_seconds:           Math.floor(ORDER_TTL_MS / 1000),
    },
    retry: {
      legacy_pay_matic: { method: "POST", headers: ["x-tx-hash", "x-order-id"], same_body: true },
      standard_x402:    { method: "POST", headers: ["x-payment"],               same_body: true },
    },
    instructions: [
      `Either:`,
      `  A) Standard x402 (Polygon CLI / agent-cli compatible):`,
      `     - Sign ERC-3009 transferWithAuthorization for USDC/USDT to ${BRIDGE_MERCHANT_WALLET}`,
      `     - Resend with x-payment: base64(<JSON payload>)`,
      `  B) Legacy aifinpay-pay-matic (atomic POL split):`,
      `     - Call B2BSplitter.payMatic(${BRIDGE_MERCHANT_WALLET}, address(0), "${orderId}") with msg.value=${totalWei} wei`,
      `     - Resend with x-tx-hash + x-order-id headers`,
    ],
  });
}

// Submit an x402 payment payload to the Polygon facilitator's /verify and
// /settle endpoints. Returns { ok, payer, tx, raw } on success; { ok:false, reason }
// on failure. Bridge never touches private keys — facilitator broadcasts
// the ERC-3009 transferWithAuthorization tx and reports back.
async function verifyX402Payment(paymentHeader, paymentRequirements) {
  const body = {
    x402Version:         1,
    paymentHeader,
    paymentRequirements,
  };
  // 1) /verify — offline signature check
  let verifyRes;
  try {
    verifyRes = await fetch(`${X402_FACILITATOR_URL}/verify`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, reason: `facilitator /verify unreachable: ${e.message}` };
  }
  if (!verifyRes.ok) {
    return { ok: false, reason: `facilitator /verify ${verifyRes.status}: ${await verifyRes.text()}` };
  }
  const verifyJson = await verifyRes.json();
  if (!verifyJson.isValid) {
    return { ok: false, reason: `facilitator says invalid: ${verifyJson.invalidReason || "no reason"}` };
  }
  // 2) /settle — facilitator broadcasts
  let settleRes;
  try {
    settleRes = await fetch(`${X402_FACILITATOR_URL}/settle`, {
      method:  "POST",
      headers: { "content-type": "application/json" },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, reason: `facilitator /settle unreachable: ${e.message}` };
  }
  if (!settleRes.ok) {
    return { ok: false, reason: `facilitator /settle ${settleRes.status}: ${await settleRes.text()}` };
  }
  const settleJson = await settleRes.json();
  if (!settleJson.success) {
    return { ok: false, reason: `facilitator /settle failed: ${settleJson.error || "no error"}` };
  }
  return {
    ok:    true,
    payer: settleJson.payer || null,
    tx:    settleJson.transaction || null,
    raw:   settleJson,
  };
}

async function verifyTx(txHash, expectedOrderId) {
  if (await isTxConsumed(txHash)) {
    return { ok: false, reason: "tx already consumed (replay)" };
  }
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (e) {
    return { ok: false, reason: `receipt fetch failed: ${e.shortMessage || e.message}` };
  }
  if (receipt.status !== "success") return { ok: false, reason: "tx reverted" };
  if (!receipt.to || getAddress(receipt.to) !== getAddress(SPLITTER_ADDRESS)) {
    return { ok: false, reason: `tx not addressed to splitter ${SPLITTER_ADDRESS}` };
  }
  const events = parseEventLogs({
    abi: SPLITTER_EVENT_ABI,
    eventName: "Payment",
    logs: receipt.logs,
  });
  if (events.length === 0) return { ok: false, reason: "Payment event not found" };
  const ev = events[0];
  const { payer, merchant, token, totalAmount, merchantAmount, orderId } = ev.args;
  if (orderId !== expectedOrderId)             return { ok: false, reason: `orderId mismatch` };
  if (token !== "0x0000000000000000000000000000000000000000") return { ok: false, reason: "expected MATIC" };
  if (getAddress(merchant) !== getAddress(BRIDGE_MERCHANT_WALLET)) {
    return { ok: false, reason: `merchant mismatch` };
  }
  if (totalAmount < BigInt(PRICE_WEI)) {
    return { ok: false, reason: `underpaid: ${totalAmount} < ${PRICE_WEI}` };
  }
  return {
    ok: true,
    payer,
    totalAmountWei: totalAmount.toString(),
    merchantAmountWei: merchantAmount.toString(),
    blockNumber: receipt.blockNumber.toString(),
  };
}

function upstreamHeaders() {
  const h = { "content-type": "application/json", accept: "application/json" };
  if (GCORE_AUTH_SCHEME.toLowerCase() === "x-api-key") {
    h["x-api-key"] = GCORE_API_KEY;
  } else if (GCORE_AUTH_SCHEME.toLowerCase() === "apikey") {
    h["authorization"] = `APIKey ${GCORE_API_KEY}`;
  } else {
    h["authorization"] = `Bearer ${GCORE_API_KEY}`;
  }
  return h;
}

const app = express();
app.set("trust proxy", 1); // single nginx hop in front of the bridge
app.use(express.json({ limit: "1mb" }));

const challengeLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }, // we sit behind nginx with trust proxy=1
  message: { error: "rate_limit_exceeded" },
});

app.get("/", (_req, res) => res.json({
  service: SERVICE_NAME,
  description: "AiFinPay-gated proxy in front of Gcore Everywhere Inference (managed LLM inference)",
  upstream: GCORE_API_URL,
  pricing: { total_wei: PRICE_WEI, split: "98.99% merchant / 1.00% treasury / 0.01% creator" },
}));

app.get("/.well-known/x402.json", (_req, res) => res.json({
  protocol: "AiFinPay v5.3",
  facilitator: "aifinpay-pay-matic",
  chain: "polygon",
  splitter: SPLITTER_ADDRESS,
  merchant_wallet: BRIDGE_MERCHANT_WALLET,
  total_wei: PRICE_WEI,
  paid_endpoints: ["/chat/completions"],
}));

app.post("/chat/completions", challengeLimiter, async (req, res) => {
  if (!req.body || !req.body.messages) {
    return res.status(400).json({ error: "messages array required (OpenAI-compatible body)" });
  }

  // ── Standard x402 path — Polygon agent-cli / x402-aware agents ──────
  // Client signs an ERC-3009 transferWithAuthorization off-chain and
  // base64-encodes it in the x-payment header. Bridge forwards to
  // Polygon's x402-rs facilitator for verify + settle. On success the
  // facilitator broadcasts the tx and returns the hash.
  const paymentHeader = req.get("x-payment");
  if (paymentHeader) {
    // Pick one of our advertised accepts to validate against. For now we
    // accept either USDC or USDT — facilitator decodes the header and
    // matches asset+amount itself, so passing the USDC requirement here
    // is fine as a template (facilitator does the right thing).
    const requirements = {
      scheme:            "erc-3009",
      network:           "polygon",
      token:             USDC_ADDRESS,
      maxAmountRequired: PRICE_USDC_UNITS,
      resource:          X402_RESOURCE_URL,
      description:       "Gcore Llama-3.3-70B inference (1 call)",
      mimeType:          "application/json",
      payTo:             BRIDGE_MERCHANT_WALLET,
      maxTimeoutSeconds: Math.floor(ORDER_TTL_MS / 1000),
      extra:             { name: "USD Coin", version: "2" },
    };
    const settled = await verifyX402Payment(paymentHeader, requirements);
    if (!settled.ok) {
      return res.status(402).json({ error: "payment_verification_failed", detail: settled.reason });
    }
    // Forward to upstream and set the standard x402 receipt header.
    let upstreamRes;
    try {
      upstreamRes = await fetch(GCORE_API_URL, {
        method:  "POST",
        headers: upstreamHeaders(),
        body:    JSON.stringify(req.body),
      });
    } catch (e) {
      return res.status(502).json({ error: "upstream_unreachable", detail: e.message });
    }
    const upstreamBody = await upstreamRes.text();
    res.set("x-payment-response", Buffer.from(JSON.stringify({
      success:     true,
      transaction: settled.tx,
      payer:       settled.payer,
    })).toString("base64"));
    res.status(upstreamRes.status).type("application/json").send(upstreamBody);
    return;
  }

  // ── Legacy aifinpay-pay-matic path — atomic POL split via B2BSplitter ─
  const txHash  = req.get("x-tx-hash");
  const orderId = req.get("x-order-id");

  if (!txHash || !orderId) return challenge402(res);
  if (!(await hasOrder(orderId))) {
    return res.status(409).json({
      error: "unknown_or_expired_order_id",
      detail: `Order "${orderId}" was not issued by this bridge or has expired.`,
    });
  }

  const verified = await verifyTx(txHash, orderId);
  if (!verified.ok) {
    return res.status(402).json({ error: "payment_verification_failed", detail: verified.reason });
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(GCORE_API_URL, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    return res.status(502).json({
      error: "upstream_unreachable",
      detail: `Everywhere Inference call failed: ${e.message}. Retry with same headers.`,
    });
  }

  if (upstreamRes.status >= 500) {
    let body;
    try { body = await upstreamRes.text(); } catch { body = "<unreadable>"; }
    return res.status(502).json({
      error: "upstream_5xx",
      upstream_status: upstreamRes.status,
      upstream_body: body.slice(0, 500),
    });
  }

  await Promise.all([consumeOrder(orderId), markTxConsumed(txHash)]);

  let payload;
  try { payload = await upstreamRes.json(); } catch { payload = { error: "upstream_non_json" }; }

  res.set("x-payment-receipt", JSON.stringify({
    paid_by:             verified.payer,
    total_amount_wei:    verified.totalAmountWei,
    merchant_amount_wei: verified.merchantAmountWei,
    tx_hash:             txHash,
    block:               verified.blockNumber,
    splitter:            SPLITTER_ADDRESS,
    order_id:            orderId,
  }));
  return res.status(upstreamRes.status).json(payload);
});

app.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] x402 paid-proxy bridge on port ${PORT}`);
  console.log(`  Upstream:    ${GCORE_API_URL}`);
  console.log(`  Auth scheme: ${GCORE_AUTH_SCHEME}`);
  console.log(`  Splitter:    ${SPLITTER_ADDRESS}`);
  console.log(`  Merchant:    ${BRIDGE_MERCHANT_WALLET}`);
  console.log(`  Total:       ${PRICE_WEI} wei (~${(Number(PRICE_WEI) / 1e18).toFixed(6)} POL) per call`);
});
