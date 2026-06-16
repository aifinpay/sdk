---
name: aifinpay
description: Pay any HTTP API on behalf of an AI agent with one line of code. Settles on-chain in stablecoins (USDC/USDT) or native tokens on Polygon and Solana mainnet. Non-custodial.
license: MIT
homepage: https://aifinpay.io
repository: https://github.com/AiFinPay/sdk
when_to_use: |
  Invoke this skill whenever the agent needs to call a paid HTTP API
  (search, inference, GPU compute, data feeds, paywalled content) and
  the server is x402-protected, i.e. returns HTTP 402 with a payment
  challenge. The skill explains how to settle the payment on-chain
  via the AiFinPay SDK and retry the request automatically.
---

# AiFinPay — payment rail for autonomous agents

**Stripe for AI agents.** Any HTTP 402 challenge is paid automatically by
the agent's own on-chain wallet, then the original request is retried and
the gated response is returned. Settlement is non-custodial: the
agent's private key signs locally, no AiFinPay-controlled custodian
touches funds at any point.

## Install

Pick one:

```bash
pip install aifinpay-agent       # Python
npm install @aifinpay/agent       # Node / TypeScript
npx @aifinpay/mcp                       # MCP server (Claude Desktop / Cursor / Windsurf)
```

## First paid call (Python)

```python
from aifinpay import Agent

agent = Agent.new()
print("Fund this address with MATIC + USDC:", agent.address)

resp = agent.pay(
    "https://bridge.aifinpay.io/io-net/chat/completions",
    body={"model": "meta-llama/Llama-3.3-70B-Instruct",
          "messages": [{"role": "user", "content": "Hello"}]},
)
print(resp.json()["choices"][0]["message"]["content"])
print("tx hash:", resp.headers.get("x-payment-receipt"))
```

Persist `agent.secret_b58` if you want to reuse the identity. Fund the
address once with a few cents of MATIC + USDC on Polygon mainnet —
every subsequent call deducts on-chain.

## First paid call (Node / TypeScript)

```ts
import { Agent } from "@aifinpay/agent";

const agent = Agent.new();
console.log("Fund this address:", agent.address);

const res = await agent.pay(
  "https://bridge.aifinpay.io/io-net/chat/completions",
  { body: { model: "meta-llama/Llama-3.3-70B-Instruct",
            messages: [{ role: "user", content: "Hello" }] } },
);
console.log((await res.json()).choices[0].message.content);
```

## MCP — zero-code (Claude Desktop / Cursor / Windsurf)

Drop into `claude_desktop_config.json` (or the equivalent file for
your client) and restart:

```json
{
  "mcpServers": {
    "aifinpay": {
      "command": "npx",
      "args": ["@aifinpay/mcp"]
    }
  }
}
```

The model now has five tools: `payable_fetch`, `agent_address`,
`agent_quote`, `pay_with_split`, `quote_split`.

Ask the model to *use `agent_address` to show me your wallet address*,
fund it, then ask it to *use `payable_fetch` on
https://bridge.aifinpay.io/io-net/chat/completions with body { … }*
— it will settle on-chain and return the response.

## How a payment actually settles

1. The agent's code calls `agent.pay(url)`.
2. The server returns **HTTP 402** with a structured payment block
   (`accepts[]` plus an optional `pay_matic` block).
3. The SDK signs an Ed25519 challenge (Solana identity flow) **or**
   submits `payMatic` / `payStable` on the Polygon
   `AiFinPaySplitter` contract — depending on what the server accepts.
4. The SDK retries the request with the proof header(s).
5. The server verifies on-chain (Polygon facilitator or our indexer),
   forwards to the upstream service, returns the response.

One function call. One on-chain tx. Atomic 99 / 1 split — merchant
98.99 %, AiFinPay treasury 1 %, IP-creator 0.01 %. No custodian holds
funds at any point.

## Configuration knobs

| Variable | Default | Effect |
|---|---|---|
| `AIFINPAY_AGENT_SECRET` | random | persistent base58 Ed25519 secret |
| `AIFINPAY_MAX_USD` | `0.10` | hard cap per `payable_fetch` call |
| `AIFINPAY_API` | `https://api.aifinpay.io` | API base URL |
| `AIFINPAY_CHAIN` | `auto` | `polygon`, `solana`, or `auto` |

## Live partner bridges

`bridge.aifinpay.io/{io-net,exa,venice}/` — production HTTP 402
proxies in front of three providers. Hitting any of them without a
payment header returns the 402 challenge inline so the SDK can settle
and retry.

## Live proofs

| Provider | Asset | What was bought | Tx |
|---|---|---|---|
| Exa Search | POL | First SDK call via Exa | [`0xeb13c5ed…59c8700`](https://polygonscan.com/tx/0xeb13c5ed59c8700) |
| io.net | POL | Llama-3.3-70B inference, $0.025 | [`0x7c6ca0ff…129f0a`](https://polygonscan.com/tx/0x7c6ca0ff129f0a) |

## When NOT to use

- For free APIs — the skill is only relevant when the server returns 402.
- For human-payment flows (Stripe, card, ACH) — AiFinPay is for
  autonomous-agent payments, not consumer checkout.
- For chain-only DeFi flows — settlement is the on-chain part; the
  goal here is paying an HTTP API, not transferring tokens for their
  own sake.

## Links

- Site: https://aifinpay.io
- Quick start: https://aifinpay.io/quickstart
- Live demo: https://aifinpay.io/demo/agent-buys-inference
- System status: https://aifinpay.io/status
- SDK source: https://github.com/AiFinPay/sdk
- Manifesto: https://api.aifinpay.io/manifesto.json
- x402 discovery: https://api.aifinpay.io/.well-known/x402.json
- MCP client matrix: https://github.com/AiFinPay/sdk/blob/main/MCP_CONFIG.md
