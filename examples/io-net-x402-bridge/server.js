// ──────────────────────────────────────────────────────────────────────────
// io-net-x402-bridge — paid-proxy in front of io.net IO Intelligence
// (managed LLM inference on io.net's GPU pool).
//
// Same Polygon-pilot pattern as exa- and venice-x402-bridge: agent calls
// B2BSplitter.payMatic(merchant, address(0), orderId), bridge verifies
// the receipt and forwards the request to api.intelligence.io.solutions
// using the bridge operator's pooled API key.
//
// IO Intelligence is OpenAI-compatible — drop in chat-completions body
// with model + messages and it works. Auth: Bearer token by default;
// override with IONET_AUTH_SCHEME=x-api-key if your key requires that.
//
// Run:
//   IONET_API_KEY=... \
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

const PORT                   = process.env.PORT                   || 3003;
const SERVICE_NAME           = process.env.SERVICE_NAME           || "io-net-x402-bridge";
const IONET_API_URL          = process.env.IONET_API_URL          || "https://api.intelligence.io.solutions/api/v1/chat/completions";
const IONET_API_KEY          = process.env.IONET_API_KEY          || "";
// Most IO Intelligence keys use OpenAI-style "Authorization: Bearer". If io.net
// docs say to use "x-api-key" instead, set IONET_AUTH_SCHEME=x-api-key.
const IONET_AUTH_SCHEME      = process.env.IONET_AUTH_SCHEME      || "bearer";
const POLYGON_RPC            = process.env.POLYGON_RPC            || "https://1rpc.io/matic";
const SPLITTER_ADDRESS       = process.env.SPLITTER_ADDRESS_POLYGON
                            || "0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440";
const BRIDGE_MERCHANT_WALLET = process.env.BRIDGE_MERCHANT_WALLET || "";
// Default 0.25 POL (~$0.025) per inference call. IO Intelligence per-token
// pricing on llama-3-70B ≈ $0.001-0.005 per typical agent call — leaves
// 5-20× margin on the bridge. Adjust to match the model you route most.
const PRICE_WEI              = process.env.PRICE_WEI              || "250000000000000000";
const ORDER_TTL_MS           = 10 * 60_000;

if (!IONET_API_KEY) {
  console.warn(`[${SERVICE_NAME}] WARNING: IONET_API_KEY not set — upstream calls will 401.`);
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
  return `io-net-${crypto.randomUUID().slice(0, 18)}`;
}

async function challenge402(res) {
  const orderId = issueOrderId();
  await putOrder(orderId, "");
  const totalWei = BigInt(PRICE_WEI);
  const treasuryAmt = (totalWei * 100n) / 10000n;
  const ipAmt       = (totalWei * 1n)   / 10000n;
  const merchantAmt = totalWei - treasuryAmt - ipAmt;

  return res.status(402).json({
    error: "Payment Required",
    protocol: "AiFinPay v5.3",
    service: SERVICE_NAME,
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
      method:    "POST",
      headers:   ["x-tx-hash", "x-order-id"],
      same_body: true,
    },
    instructions: [
      `1. Call B2BSplitter.payMatic(${BRIDGE_MERCHANT_WALLET}, address(0), "${orderId}") on Polygon`,
      `2. Send msg.value = ${totalWei} wei`,
      `3. Resend this request with headers: x-tx-hash: <hash>, x-order-id: ${orderId}`,
    ],
  });
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
  if (IONET_AUTH_SCHEME.toLowerCase() === "x-api-key") {
    h["x-api-key"] = IONET_API_KEY;
  } else {
    h["authorization"] = `Bearer ${IONET_API_KEY}`;
  }
  return h;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

const challengeLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limit_exceeded" },
});

app.get("/", (_req, res) => res.json({
  service: SERVICE_NAME,
  description: "AiFinPay-gated proxy in front of io.net IO Intelligence (managed LLM inference)",
  upstream: IONET_API_URL,
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
    upstreamRes = await fetch(IONET_API_URL, {
      method: "POST",
      headers: upstreamHeaders(),
      body: JSON.stringify(req.body),
    });
  } catch (e) {
    return res.status(502).json({
      error: "upstream_unreachable",
      detail: `IO Intelligence call failed: ${e.message}. Retry with same headers.`,
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
  console.log(`  Upstream:    ${IONET_API_URL}`);
  console.log(`  Auth scheme: ${IONET_AUTH_SCHEME}`);
  console.log(`  Splitter:    ${SPLITTER_ADDRESS}`);
  console.log(`  Merchant:    ${BRIDGE_MERCHANT_WALLET}`);
  console.log(`  Total:       ${PRICE_WEI} wei (~${(Number(PRICE_WEI) / 1e18).toFixed(6)} POL) per call`);
});
