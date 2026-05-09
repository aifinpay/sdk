/**
 * AiFinPay agent SDK — non-custodial multi-facilitator x402 client.
 *
 * Quick start:
 *   import { Agent, PayOptions } from "@aifinpay/agent";
 *
 *   const agent = Agent.new();
 *   console.log("Fund this address:", agent.address);
 *   await agent.waitForFunding({ minUsdCents: 1 });
 *   const invoice = await agent.reserveSeatInvoice({ amountUsd: 1.0, asset: "USDC" });
 *
 *   // Generic x402 — auto-detects facilitator, signs, retries
 *   const res = await agent.pay("https://aifinpay.company/api/stats");
 *   const data = await res.json();
 *
 *   // Pay any third-party x402 endpoint with a budget cap
 *   await agent.pay("https://api.example.com/v1/data", {
 *     method: "POST",
 *     body: JSON.stringify({ q: "hello" }),
 *     headers: { "content-type": "application/json" },
 *     options: { maxAmountUsd: 0.10 },
 *   });
 */
export { Agent } from "./agent.js";
export type { AgentOptions, Invoice, PayInit } from "./agent.js";
export {
  AiFinPayError,
  FacilitatorNotImplementedError,
  FundingTimeoutError,
  PaymentTooExpensiveError,
  SeatNotFoundError,
  UnsupportedFacilitatorError,
  X402Error,
} from "./errors.js";
export {
  AiFinPayFacilitator,
  CoinbaseX402Facilitator,
  REGISTERED,
  detectFacilitator,
} from "./facilitators/index.js";
export type {
  AuthPayload,
  Facilitator,
  FacilitatorClass,
  PayOptions,
} from "./facilitators/index.js";
