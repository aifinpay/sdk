# AiFinPay × Flowise

Custom tool node for [Flowise](https://flowiseai.com/). Drop the JSON
below into your project to add a `payable_fetch` node any agent flow can
use.

## Install

1. In Flowise, open **Settings → Custom Tool**.
2. Paste the contents of [`payable_fetch_tool.json`](./payable_fetch_tool.json).
3. Save. The node now appears under **Tools** in the canvas palette.

## What it does

The custom tool wraps the AiFinPay Node SDK (`@aifinpay/agent`). On each
call:

1. The tool reads the agent's persisted secret from
   `process.env.AIFINPAY_AGENT_SECRET` (set this in Flowise → Settings →
   Variables).
2. It calls `agent.pay(url, { body })`.
3. The Flowise agent sees the response body as the tool output.

## Funding the agent

```bash
node -e "const {Agent}=require('@aifinpay/agent'); const a=Agent.new(); console.log({address:a.address, secret:a.secretB58})"
```

Save the secret as the `AIFINPAY_AGENT_SECRET` env variable in Flowise.
Fund the address with a few cents of MATIC + USDC on Polygon mainnet.

## Files

- `payable_fetch_tool.json` — paste into Flowise Custom Tool.
