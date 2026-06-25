# @aifinpay/mcp

MCP server exposing AiFinPay's autonomous x402 payment loop as
agent-callable tools. Drop it into Claude Desktop, MCP Inspector, or any
MCP-aware agent runtime — your agent can now buy services autonomously.

## Tools

### Payment / agent
| Tool | What it does |
|---|---|
| `payable_fetch(url, opts?)` | Fetch any URL. On HTTP 402, auto-detect the facilitator, sign, pay, and retry. |
| `agent_call({provider, body})` | Pay a registered AiFinPay provider and return its response (unified call). |
| `agent_quote(url)` | Inspect a 402 challenge without paying — quoted amount + facilitator flavor. |
| `agent_address()` | Return the agent's address so you know where to fund it. |
| `agent_claim_self(...)` | Publish/claim this agent on the public AiFinPay network directory. |
| `pay_with_split(...)` | Execute a fee-on-top (B2B) split payment. |
| `quote_split(...)` | Preview the fee-on-top split breakdown without paying. |

### Marketplace directory (read-only)
| Tool | What it does |
|---|---|
| `list_providers()` | List the AI services available through AiFinPay with per-call prices. |
| `provider_info(name)` | Details for one provider (price, networks, service type). |
| `provider_status()` | Which provider bridges are currently reachable. |
| `service_coverage()` | Which categories AiFinPay covers and the providers in each. |
| `network_stats()` | Public protocol statistics. |
| `leaderboard()` | Public on-chain leaderboard of AiFinPay agents. |
| `quote_cost(...)` | Preview the fee-on-top cost for a given price (no payment). |
| `verify_passport(pubkey)` | Whether a key holds an AiFinPay AgentPassport. |
| `agent_profile(address)` | Public profile + activity summary for an agent. |

## Install

```bash
# Globally — usable as `npx @aifinpay/mcp` from any client config
npm install -g @aifinpay/mcp
```

## Use with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aifinpay": {
      "command": "npx",
      "args": ["@aifinpay/mcp"],
      "env": {
        "AIFINPAY_AGENT_SECRET": "<base58 secret — see below>",
        "AIFINPAY_MAX_USD": "0.50"
      }
    }
  }
}
```

Restart Claude Desktop. Now Claude can call any of the tools above —
`payable_fetch`, `agent_call`, `pay_with_split`, and the read-only
marketplace directory — like any other tool.

## First run — generating an agent

If `AIFINPAY_AGENT_SECRET` is not set, the server generates an ephemeral
keypair and **prints it to stderr** at startup:

```
[warn] no AIFINPAY_AGENT_SECRET set — generated EPHEMERAL agent.
  address: 9HucVaL5yinJ4MfBKCFnz5QJBGwK33bfSQKw15pSe3Ch
  secret:  2vfeWAYfkpTNGSgDpBonzmjkckrTKa5GTnhhztY141YcSKYrqCvtojVukQAQiJbbRLgdcfEdyqHbRMsUft6Pb7nD
  >> Save this secret to AIFINPAY_AGENT_SECRET to keep the agent across restarts.
```

Save the secret to `AIFINPAY_AGENT_SECRET` in your client config so the
agent identity (and any funded Seat) persists across restarts.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `AIFINPAY_AGENT_SECRET` | — | Base58 secret. If absent → ephemeral agent printed to stderr. |
| `AIFINPAY_BASE_URL` | `https://aifinpay.io` | Backend URL for nonce + funding probes. |
| `AIFINPAY_TIMEOUT_MS` | `30000` | Request timeout. |
| `AIFINPAY_MAX_USD` | — | Hard cap per single payment. Strongly recommended. |

## Programmatic use

```ts
import { createServer, loadConfigFromEnv } from "@aifinpay/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const { server } = await createServer({
  ...loadConfigFromEnv(),
  agentSecretB58: "your-secret-here",
  maxAmountUsd: 0.10,
});
await server.connect(new StdioServerTransport());
```

## How `payable_fetch` works

1. Sends the request unauthenticated.
2. On `402`, the underlying [`@aifinpay/agent`](../node) SDK detects the
   facilitator flavor (AiFinPay native, Coinbase x402, …).
3. Signs a payment payload and retries.
4. Returns `{ status, ok, headers, body }` to the agent.

The flow is identical to calling `agent.pay(url)` directly — this
package just wraps it as an MCP tool surface so LLM agents can call it
without writing payment code.

## License

MIT.
