"""
LangChain × AiFinPay
--------------------
Expose `aifinpay.Agent.pay(url)` as a LangChain BaseTool.
"""

from langchain.tools import BaseTool
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from aifinpay import Agent as PayAgent
from pydantic import BaseModel, Field


pay_agent = PayAgent.new()
print(f"[bootstrap] address={pay_agent.address}")
print(f"[bootstrap] secret={pay_agent.secret_b58}  # persist this to keep funds")


class PayableFetchInput(BaseModel):
    url: str = Field(description="URL to fetch")
    body: dict | None = Field(default=None, description="Optional JSON body")


class PayableFetchTool(BaseTool):
    name: str = "payable_fetch"
    description: str = (
        "Fetch any URL. If the server returns 402 (Payment Required), the tool "
        "settles the payment on-chain via the AiFinPay agent wallet and retries. "
        "Returns the response body as a string."
    )
    args_schema: type = PayableFetchInput

    def _run(self, url: str, body: dict | None = None) -> str:
        return pay_agent.pay(url, body=body).text

    async def _arun(self, url: str, body: dict | None = None) -> str:
        return self._run(url, body)


tools = [PayableFetchTool()]
llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are an autonomous agent that can buy x402-gated services with payable_fetch."),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])

agent = create_openai_tools_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)


if __name__ == "__main__":
    out = executor.invoke({
        "input": (
            "Buy a one-sentence completion: payable_fetch "
            "https://bridge.aifinpay.company/io-net/chat/completions with body "
            "{\"model\":\"meta-llama/Llama-3.3-70B-Instruct\","
            "\"messages\":[{\"role\":\"user\",\"content\":\"In one sentence: what is x402?\"}]}. "
            "Then summarize the result."
        ),
    })
    print("\n=== OUTPUT ===\n", out["output"])
