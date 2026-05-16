# AiFinPay × headless autonomous loop (AutoGPT-style)

Minimal long-running agent that funds itself once, then keeps buying
inference + search calls in a loop until its balance runs out.

This isn't tied to the AutoGPT framework specifically — it's the
canonical pattern for any headless agent that must operate unattended
on a fixed budget.

## Setup

```bash
pip install aifinpay-agent --pre openai
export OPENAI_API_KEY=sk-...
python loop.py
```

The first run prints a Polygon address. Fund it with ~$2 of MATIC +
USDC. Re-run. The loop runs until the agent's USDC balance drops below
a configured floor.

## Files

- `loop.py` — bootstraps a persistent agent identity, runs a perpetual
  research loop, halts on low balance.
