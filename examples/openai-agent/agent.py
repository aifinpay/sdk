"""
OpenAI Agents SDK × AiFinPay
----------------------------
Wraps `aifinpay.Agent.pay(url)` as a tool, lets GPT-4 buy x402-gated
inference autonomously.
"""

from openai import OpenAI
from aifinpay import Agent as PayAgent

# Persistent agent identity. First run: print address, fund it, rerun.
pay_agent = PayAgent.new()
print(f"[bootstrap] Pay-agent address: {pay_agent.address}")
print(f"[bootstrap] Persist this secret to reuse identity: {pay_agent.secret_b58}")

openai = OpenAI()


def payable_fetch(url: str, json_body: dict | None = None) -> str:
    """Fetch a URL; auto-settle the 402 challenge on-chain if needed."""
    resp = pay_agent.pay(url, body=json_body)
    return resp.text


# OpenAI Tools schema
tools = [{
    "type": "function",
    "function": {
        "name": "payable_fetch",
        "description": "Fetch any URL. If the server returns 402, settle the payment on-chain via the AiFinPay agent wallet and retry.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "json_body": {"type": "object"},
            },
            "required": ["url"],
        },
    },
}]


def run(user_msg: str) -> str:
    messages = [{"role": "user", "content": user_msg}]
    while True:
        r = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
        msg = r.choices[0].message
        messages.append(msg)
        if not msg.tool_calls:
            return msg.content
        for tc in msg.tool_calls:
            args = __import__("json").loads(tc.function.arguments)
            out = payable_fetch(**args)
            messages.append({
                "tool_call_id": tc.id,
                "role": "tool",
                "name": tc.function.name,
                "content": out,
            })


if __name__ == "__main__":
    answer = run(
        "Use payable_fetch to call https://bridge.aifinpay.company/io-net/chat/completions "
        "with {\"model\":\"meta-llama/Llama-3.3-70B-Instruct\",\"messages\":[{\"role\":\"user\",\"content\":\"In one sentence: what is x402?\"}]}, "
        "then summarize the assistant's reply."
    )
    print("\n=== ANSWER ===")
    print(answer)
