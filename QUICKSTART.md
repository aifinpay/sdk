# QUICKSTART — first paid call in 60 seconds

This walks you from a clean machine to your first verified on-chain
payment via the AiFinPay SDK. No KYC, no API key, no custodian.

There are three paths. Pick whichever matches what you're building:

1. **Python or Node SDK** — programmatic use from your own agent code.
2. **Claude Desktop / Cursor (MCP)** — zero-code; the LLM gets payment
   tools automatically.
3. **Framework adapter** (LangChain, CrewAI, OpenAI Agents, AutoGPT…) —
   plug `agent.pay()` into your existing pipeline.

## Path 1 — Python SDK

```bash
pip install aifinpay-agent --pre
```

```python
from aifinpay import Agent

# Generate a fresh keypair. Persist `agent.secret_b58` if you want to
# reuse this agent identity later.
agent = Agent.new()
print("Fund this address with a few cents of MATIC:", agent.address)

# Once funded, this autonomously settles the 402 challenge on-chain and
# returns the gated response body.
resp = agent.pay(
    "https://bridge.aifinpay.company/io-net/chat/completions",
    body={"model": "meta-llama/Llama-3.3-70B-Instruct",
          "messages": [{"role": "user", "content": "Hello"}]},
)
print(resp.json()["choices"][0]["message"]["content"])
print("tx hash:", resp.headers.get("x-payment-receipt"))
```

## Path 2 — Node / TypeScript SDK

```bash
npm install @aifinpay/agent@alpha
```

```ts
import { Agent } from "@aifinpay/agent";

const agent = Agent.new();
console.log("Fund this address:", agent.address);

const res = await agent.pay(
  "https://bridge.aifinpay.company/io-net/chat/completions",
  { body: { model: "meta-llama/Llama-3.3-70B-Instruct",
            messages: [{ role: "user", content: "Hello" }] } },
);
const data = await res.json();
console.log(data.choices[0].message.content);
```

## Path 3 — MCP (Claude Desktop / Cursor / Windsurf)

Drop this into `claude_desktop_config.json` (or your client's MCP
config):

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

Restart the client and ask: *"What's your wallet address?"* — the
`agent_address` tool returns it. Fund it. Then ask: *"Pay the io.net
bridge for a one-line completion."* — the model handles the rest.

Full client matrix in [`MCP_CONFIG.md`](./MCP_CONFIG.md).

## Path 4 — agent frameworks

Working examples for each framework live under
[`./examples/`](./examples). Each is a single file, paste-and-run:

- [`examples/openai-agent`](./examples/openai-agent) — OpenAI Agents SDK
- [`examples/langchain`](./examples/langchain) — LangChain `BaseTool`
- [`examples/crewai`](./examples/crewai) — CrewAI crew that buys
  inference + search calls
- [`examples/flowise`](./examples/flowise) — Flowise custom node
- [`examples/autogpt`](./examples/autogpt) — headless self-funding loop

## How a payment actually settles

1. Your code calls `agent.pay(url)`.
2. The server returns **HTTP 402** with a JSON `accepts[]` block (or our
   `pay_matic` block). It lists: chain, asset, payTo, amount,
   `nonce`.
3. The SDK signs an Ed25519 challenge (Solana-style identity) or
   submits a `payMatic`/`payStable` tx on Polygon, depending on what the
   server accepts.
4. The SDK retries the request with the proof header(s).
5. The server verifies on-chain (via the Polygon facilitator or our
   indexer), forwards to the upstream service, and returns the
   response.

You see one function call. Under the hood: one tx on mainnet, atomic
99/1 split (merchant 98.99% / treasury 1% / IP-creator 0.01%), no
custodian holds funds at any point.

## What this is for

- **AI agents that need to buy compute / data / inference**, e.g. an
  autonomous research crew that pays per call to Exa, io.net, Venice.
- **Anyone with an existing API** who wants to charge per call — wrap
  it once with the [`echo-x402-server`](./examples/echo-x402-server)
  recipe and you have an x402-payable endpoint.
- **MCP-aware LLM clients** (Claude Desktop, Cursor, Windsurf…) that
  should be able to buy paid services without a hardcoded API key.

## What this is not

- Not a custodian. We never hold your agent's funds.
- Not a chain. Settlement is on Polygon and Solana mainnet.
- Not an investment. mSECCO is a non-transferable internal accounting
  unit.

## Live proofs (Polygonscan)

- First Exa search via SDK:
  [`0xeb13c5ed…59c8700`](https://polygonscan.com/tx/0xeb13c5ed59c8700)
- Llama-3.3-70B inference via io.net, $0.025:
  [`0x7c6ca0ff…129f0a`](https://polygonscan.com/tx/0x7c6ca0ff129f0a)

## Next

- Full API surface: [`https://aifinpay.company/docs`](https://aifinpay.company/docs)
- x402 discovery doc: [`https://api.aifinpay.company/.well-known/x402.json`](https://api.aifinpay.company/.well-known/x402.json)
- Issues / questions: [GitHub Issues](https://github.com/AiFinPay/sdk/issues)
