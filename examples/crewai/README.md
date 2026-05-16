# AiFinPay × CrewAI

A two-agent research crew that pays per call. The Researcher buys
search and inference; the Editor synthesizes.

## Setup

```bash
pip install aifinpay-agent --pre crewai crewai-tools
export OPENAI_API_KEY=sk-...
python crew.py
```

Fund the printed address with a couple dollars of MATIC + USDC, then
re-run. The crew makes several paid calls.

## Files

- `crew.py` — two agents, two tools (`paid_search`, `paid_inference`),
  one task graph.
