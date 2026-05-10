// ──────────────────────────────────────────────────────────────────────────
// End-to-end demo client for the Exa x402 bridge.
//
// Drives the full autonomous-commerce loop:
//   1. POST /search without auth → expect 402 with pay_matic details
//   2. Submit B2BSplitter.payMatic(merchant, address(0), orderId) on
//      Polygon, msg.value = total_wei. Contract splits 98.99/1/0.01.
//   3. Wait for confirmation.
//   4. Retry POST /search with x-tx-hash + x-order-id headers — bridge
//      verifies the receipt + Payment event on-chain and forwards to
//      api.exa.ai.
//
// Run:
//   AGENT_PRIVATE_KEY=0x... \
//   BRIDGE_URL=http://localhost:3001 \
//   node test-client.js "your search query"
// ──────────────────────────────────────────────────────────────────────────
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  isHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const BRIDGE_URL  = process.env.BRIDGE_URL  || "http://localhost:3001";
const POLYGON_RPC = process.env.POLYGON_RPC || "https://polygon.drpc.org";
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const QUERY       = process.argv[2] || "autonomous AI commerce on Polygon";

if (!PRIVATE_KEY || !isHex(PRIVATE_KEY) || PRIVATE_KEY.length !== 66) {
  console.error("Set AGENT_PRIVATE_KEY env to a 0x-prefixed 64-hex private key.");
  console.error("Fund it on Polygon mainnet with at least ~0.01 MATIC for gas + payment.");
  process.exit(1);
}

const SPLITTER_ABI = [{
  type: "function",
  name: "payMatic",
  stateMutability: "payable",
  inputs: [
    { type: "address", name: "merchant" },
    { type: "address", name: "ipCreator" },
    { type: "string",  name: "orderId" },
  ],
  outputs: [],
}];

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: polygon, transport: http(POLYGON_RPC) });
const walletClient = createWalletClient({ chain: polygon, transport: http(POLYGON_RPC), account });

console.log(`[client] agent EOA: ${account.address}`);

async function searchPaid(query) {
  console.log(`[client] POST ${BRIDGE_URL}/search { query: ${JSON.stringify(query)} }`);

  let r = await fetch(`${BRIDGE_URL}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (r.status !== 402) {
    throw new Error(`unexpected initial status ${r.status}: ${await r.text()}`);
  }
  const challenge = await r.json();
  const pm = challenge.pay_matic;
  console.log(`[client] received 402 — order_id=${pm.order_id} merchant=${pm.merchant_wallet}`);
  console.log(`[client] sending ${pm.total_wei} wei (${formatEther(BigInt(pm.total_wei))} MATIC); merchant gets ≈ ${formatEther(BigInt(pm.merchant_amount_wei))} MATIC`);

  console.log(`[client] submitting B2BSplitter.payMatic(...) on Polygon...`);
  const txHash = await walletClient.writeContract({
    address:      pm.splitter,
    abi:          SPLITTER_ABI,
    functionName: "payMatic",
    args: [
      pm.merchant_wallet,
      "0x0000000000000000000000000000000000000000",
      pm.order_id,
    ],
    value: BigInt(pm.total_wei),
  });
  console.log(`[client] tx submitted: ${txHash}`);
  console.log(`[client] explorer: https://polygonscan.com/tx/${txHash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`[client] tx ${receipt.status} in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
  if (receipt.status !== "success") {
    throw new Error(`tx reverted on-chain: ${txHash}`);
  }

  console.log(`[client] retrying /search with x-tx-hash + x-order-id...`);
  r = await fetch(`${BRIDGE_URL}/search`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tx-hash":    txHash,
      "x-order-id":   pm.order_id,
    },
    body: JSON.stringify({ query }),
  });
  const receiptHeader = r.headers.get("x-payment-receipt");
  if (receiptHeader) {
    console.log(`[client] x-payment-receipt: ${receiptHeader}`);
  }
  if (!r.ok) {
    throw new Error(`bridge retry failed ${r.status}: ${await r.text()}`);
  }
  return r.json();
}

const results = await searchPaid(QUERY);
console.log("\n=== Exa results ===");
console.log(JSON.stringify(results, null, 2));
