# AiFinPay × OpenAI Agents SDK

Wrap `agent.pay()` as a Tool for the OpenAI Agents SDK. Your GPT-4 / o1
agent can now autonomously call any x402-protected URL.

## Setup

```bash
pip install aifinpay-agent --pre openai
export OPENAI_API_KEY=sk-...
python agent.py
```

The first run prints a Polygon address. Fund it with a few cents of
MATIC + USDC, then re-run.

## Files

- `agent.py` — full example: defines a `payable_fetch` tool, an OpenAI
  agent that uses it, and runs a sample task.
