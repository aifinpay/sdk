# AiFinPay examples

Reference integrations you can copy and adapt.

| Example | What it shows | Stack |
|---|---|---|
| [`echo-x402-server`](./echo-x402-server) | Smallest possible **AiFinPay-gated API** for autonomous AI agents. ~70 lines of Express. | Node 18+, Express |

More coming as we build them. PRs welcome — open one against `main`.

## Quick start

```bash
# Run the gated server
cd echo-x402-server && npm install && node server.js
# → x402-gated API on port 3000

# In another shell — call it through an SDK
node test-client.js
```
