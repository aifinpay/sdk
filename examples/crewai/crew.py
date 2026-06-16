"""
CrewAI × AiFinPay
-----------------
Two-agent research crew that pays per call. Researcher buys Exa search
and io.net inference via the AiFinPay SDK; Editor synthesizes.
"""

from crewai import Agent, Task, Crew
from crewai.tools import BaseTool
from aifinpay import Agent as PayAgent
import json


pay = PayAgent.new()
print(f"[bootstrap] address={pay.address}  (fund with ~$1 of MATIC+USDC, then rerun)")


class PaidSearchTool(BaseTool):
    name: str = "paid_search"
    description: str = "Search the web via Exa. Paid per query. Input: a query string."

    def _run(self, query: str) -> str:
        resp = pay.pay(
            "https://bridge.aifinpay.io/exa/search",
            body={"query": query, "numResults": 5},
        )
        return resp.text


class PaidInferenceTool(BaseTool):
    name: str = "paid_inference"
    description: str = "Run a prompt through Llama-3.3-70B via io.net. Paid per call."

    def _run(self, prompt: str) -> str:
        resp = pay.pay(
            "https://bridge.aifinpay.io/io-net/chat/completions",
            body={
                "model": "meta-llama/Llama-3.3-70B-Instruct",
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        return json.loads(resp.text)["choices"][0]["message"]["content"]


researcher = Agent(
    role="Researcher",
    goal="Find and summarize the strongest public evidence on a topic.",
    backstory="A senior research analyst who pays for premium sources without hesitation.",
    tools=[PaidSearchTool(), PaidInferenceTool()],
    verbose=True,
)

editor = Agent(
    role="Editor",
    goal="Turn raw research into a tight, accurate brief.",
    backstory="Loves short, source-cited writing.",
    tools=[PaidInferenceTool()],
    verbose=True,
)

t1 = Task(
    description=(
        "Research the current state of x402 (the HTTP 402 payment protocol). "
        "Use paid_search for sources and paid_inference for summarization. "
        "Return raw findings."
    ),
    agent=researcher,
    expected_output="3-5 bullet points with linked sources.",
)
t2 = Task(
    description=(
        "Edit the researcher's findings into a 5-sentence executive brief."
    ),
    agent=editor,
    expected_output="One paragraph, 5 sentences, ≤120 words.",
)

crew = Crew(agents=[researcher, editor], tasks=[t1, t2], verbose=True)


if __name__ == "__main__":
    result = crew.kickoff()
    print("\n=== BRIEF ===\n", result)
