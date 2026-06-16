# Partner onboarding — join the AiFinPay agent economy

Stand up a paid bridge for your API in **30 minutes** and let autonomous
AI agents buy your service per call. AiFinPay handles the payment rail,
the agent identity, and the SDK on the buyer side; you keep the API key
and the upstream relationship.

The protocol fee (1%) is collected automatically by an on-chain
splitter — no revenue-share bookkeeping, no contracts to sign, no
custodial arrangement.

> **Architecture note**: AiFinPay is a unified agent-economy layer, not
> a chain-specific protocol. Today's pilots ship on Polygon, Solana
> per-call ships next; from the partner's perspective the bridge code
> is the same and the SDK abstracts the chain away from the agent.

## What you need from your side

| Item | Why |
|------|-----|
| 0x Polygon address (EOA or Safe) | Where your per-call revenue lands. Use a Safe for production — once funded, you own that wallet, not us. |
| Your API key for the upstream service | The bridge uses **your** key when forwarding paid requests. AiFinPay never sees it again — set it as an env var on your bridge host. |
| A box to run the bridge on | ~50 LoC Node service, runs on a $5/mo VPS or any container platform. We can host for the pilot if you don't want to. |
| A unit price | What you charge agents per call, denominated in MATIC. `PRICE_WEI` env var. |

## What you do not need

- Crypto integration in your existing stack — the bridge is in front of your unchanged API.
- A wallet for your end users — your customers are AI agents, not humans, and they bring their own keypair via the AiFinPay SDK.
- Compliance / KYC — non-custodial. Funds settle on-chain in the splitter contract.
- A subscription contract or revenue-share agreement — protocol fee is hard-coded in the splitter, automatically routed.

## Step-by-step

### 1. Fork the example

```bash
git clone https://github.com/AiFinPay/sdk.git
cd sdk/examples
cp -r exa-x402-bridge mybrand-x402-bridge
cd mybrand-x402-bridge
```

### 2. Change three knobs in `server.js`

| Knob | Default | Your value |
|------|---------|-----------|
| `EXA_API_URL` env | `https://api.exa.ai/search` | Your upstream API endpoint |
| Auth header in upstream `fetch` call | `"x-api-key": EXA_API_KEY` | Whatever your service expects (`Authorization: Bearer …`, etc.) |
| `PRICE_WEI` env | `15000000000000000` (~$0.0105 / call) | Your per-call price in wei |

That's it. The 402 challenge, on-chain verification, replay protection,
rate limiting, and Polygon-side splitter integration are unchanged.

### 3. Configure env

```bash
cp .env.example .env
# fill in:
#   YOUR_API_KEY=...
#   BRIDGE_MERCHANT_WALLET=0xYourWallet
#   PRICE_WEI=...
#   POLYGON_RPC=...
```

### 4. Run

```bash
npm install
node server.js
```

Behind nginx / Caddy / fly.io / Railway / wherever. The bridge is a
plain HTTP service, no special infra.

### 5. Tell us your merchant address

Open a PR against `oracle-financial-hub-59/backend/services.json` with
your registry entry:

```json
"0xyourwallet": {
  "name": "Your Service",
  "type": "search | inference | compute | analytics | tools | data",
  "url": "https://yourservice.com",
  "logo": "your-logo.svg"
}
```

Once merged + redeployed, your service shows up on the AiFinPay public
dashboard. Agents discover you via:

- The on-chain `Payment` events (canonical source)
- The aggregated `/api/dashboard` endpoint
- The merchant lookup at `/api/partner/:wallet`

## What the on-chain split looks like

Every successful call generates exactly one `Payment` event on the
verified `B2BSplitter` contract at
[`0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440`](https://polygonscan.com/address/0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440):

```
agent  ──msg.value──▶  B2BSplitter.payMatic
                          │
                          ├──── 98.99% ────▶  YOUR merchant wallet
                          ├──── 1.00%  ────▶  AiFinPay treasury Safe
                          └──── 0.01%  ────▶  ipCreator (or treasury if 0x0)

emit Payment(payer, merchant, address(0), totalAmount,
             merchantAmount, treasuryAmount, ipCreatorAmount, orderId)
```

You don't deploy or upgrade any contract. You don't sign a partner
agreement on-chain. The protocol fee is structural — it exists because
every `payMatic` call goes through the splitter, and the splitter has
hard-coded BPS values set by the Gnosis Safe owner.

## What you get for the 1% protocol fee

- Pre-built x402 SDK in Python (`aifinpay-agent`), Node (`@aifinpay/agent`),
  and an MCP server (`@aifinpay/mcp`) — millions of agents already
  integrate this surface.
- Discovery: appearance on the `/api/dashboard` and `aifinpay.io`
  marketplace pages.
- Identity: agents have on-chain `AgentPassport` NFTs you can trust
  without doing your own KYC.
- Webhooks for downstream events.
- A canonical x402 facilitator that translates between AiFinPay-native,
  Coinbase-x402, and (future) generic schemes — agents written for any
  of these can pay you.

## What the partner does NOT pay for

- Agents' onboarding — that's done in the `@aifinpay/agent` SDK.
- Network fees — paid by the agent submitting the tx.
- Refunds for upstream-service failures — the bridge already handles
  this: if your service returns 5xx, the bridge returns 502 to the
  agent and **does not consume** their payment, so they can retry with
  the same `x-tx-hash` for free.

## Production checklist

Before driving real volume through the bridge:

- [ ] Replace in-memory store with Redis (`REDIS_URL` env). Done by
      default if `REDIS_URL` is set.
- [ ] Use a hardware-secured wallet or a Safe for `BRIDGE_MERCHANT_WALLET`.
      Don't reuse a CI/CD secret-rotated EOA.
- [ ] Move your upstream API key to a secret manager (1Password,
      Doppler, Vault) — the `.env` file is for development only.
- [ ] Rate-limit by Polygon EOA at the application layer (the bundled
      `express-rate-limit` is per-IP only, intended as anti-spam for the
      402 challenge step).
- [ ] Wait for ≥3 confirmations before forwarding to upstream if the
      service is high-value or the quote is volatile. The current
      bridge accepts inclusion only, which is fine for Polygon's 2s
      blocks but tighten if you need to.
- [ ] Monitor the bridge's `Payment` events (or our dashboard) — if you
      see your merchant wallet missing receipts, an agent paid but the
      bridge didn't deliver. That's a refund case.

## Questions / changes

- Architecture or pilot scoping: open an issue at
  `github.com/AiFinPay/sdk/issues`.
- Direct conversation with the team: telegram, x.com/aifinpay,
  linkedin/aifinpay.
