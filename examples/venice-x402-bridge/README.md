# venice-x402-bridge

x402 paid-proxy bridge in front of [Venice AI](https://venice.ai)
chat-completions. OpenAI-compatible body — drop `https://api.venice.ai/api/v1`
into any client and replace it with this bridge URL.

Same architecture as [`../exa-x402-bridge`](../exa-x402-bridge): agent
calls `B2BSplitter.payMatic(merchant, address(0), orderId)` on Polygon,
bridge verifies the receipt + Payment event via viem, then forwards to
Venice.

## Setup

```bash
npm install

export VENICE_API_KEY="sk-..."
export BRIDGE_MERCHANT_WALLET="0x..."
export AGENT_PRIVATE_KEY="0x..."   # for the demo client
export PRICE_WEI="50000000000000000"  # 0.05 MATIC ≈ $0.035 default
```

## Run the bridge

```bash
node server.js
# → port 3002 (default)
```

## Call it

```bash
# Initial — gets 402 challenge
curl -X POST http://localhost:3002/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b","messages":[{"role":"user","content":"hi"}]}'

# Pay via Splitter, then retry with x-tx-hash + x-order-id
# (use ../exa-x402-bridge/test-client.js as a template — change endpoint
#  and body, the payment flow is identical)
```

## Adapting

This bridge is a copy-paste of the Exa one with three knobs changed:

| Knob | Where | Exa value | Venice value |
|---|---|---|---|
| Upstream URL | `VENICE_API_URL` env / `EXA_API_URL` | `https://api.exa.ai/search` | `https://api.venice.ai/api/v1/chat/completions` |
| Auth header | upstream `fetch` call | `x-api-key: ${KEY}` | `Authorization: Bearer ${KEY}` |
| Default price | `PRICE_WEI` env | 0.015 MATIC (search) | 0.05 MATIC (inference) |

The whole 402 challenge / payment verification / replay-cache /
rate-limit machinery is identical — the only differences are the
upstream URL and auth header. Stand up another service in 5 minutes by
copying this folder and changing those three knobs.
