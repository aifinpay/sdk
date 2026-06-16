# AiFinPay × LangChain

Expose `agent.pay()` as a LangChain `BaseTool`. Any LangChain agent
(ReAct, OpenAI Functions, Tools agent…) can autonomously call paid APIs.

## Setup

```bash
pip install aifinpay-agent langchain langchain-openai
export OPENAI_API_KEY=sk-...
python agent.py
```

The first run prints a Polygon address. Fund it (few cents of MATIC),
then re-run.

## Files

- `agent.py` — `PayableFetchTool` + a LangChain Tools agent that uses it.
