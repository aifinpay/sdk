"""
Headless self-funding autonomous loop.

Persistent agent identity. Runs perpetually until balance drops below
MIN_USDC. Each iteration: pick a research topic, buy a search call,
buy an inference, log the result.
"""

import os
import time
import json
from pathlib import Path

from openai import OpenAI
from aifinpay import Agent as PayAgent


MIN_USDC = 0.10
TICK_SECONDS = 30
SECRET_FILE = Path.home() / ".aifinpay" / "autogpt-agent.secret"


def load_or_create_agent() -> PayAgent:
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        secret = SECRET_FILE.read_text().strip()
        agent = PayAgent.from_secret(secret)
        print(f"[boot] resumed agent {agent.address}")
        return agent
    agent = PayAgent.new()
    SECRET_FILE.write_text(agent.secret_b58)
    print(f"[boot] created agent {agent.address}")
    print(f"[boot] fund this address with MATIC + USDC, then rerun.")
    raise SystemExit(0)


def usdc_balance(agent: PayAgent) -> float:
    """Read USDC balance via the SDK helper (returns float USD)."""
    return float(agent.balance(asset="USDC", chain="polygon"))


def pick_topic(openai: OpenAI) -> str:
    r = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": "Give me ONE niche AI infrastructure topic worth researching today. Just the topic."}],
        temperature=0.7,
    )
    return r.choices[0].message.content.strip()


def paid_search(agent: PayAgent, query: str) -> str:
    return agent.pay(
        "https://bridge.aifinpay.io/exa/search",
        body={"query": query, "numResults": 3},
    ).text


def paid_inference(agent: PayAgent, prompt: str) -> str:
    resp = agent.pay(
        "https://bridge.aifinpay.io/io-net/chat/completions",
        body={
            "model": "meta-llama/Llama-3.3-70B-Instruct",
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    return json.loads(resp.text)["choices"][0]["message"]["content"]


def main() -> None:
    agent = load_or_create_agent()
    openai = OpenAI()
    tick = 0
    while True:
        tick += 1
        bal = usdc_balance(agent)
        print(f"[tick {tick}] balance=${bal:.4f}")
        if bal < MIN_USDC:
            print(f"[halt] balance below ${MIN_USDC:.2f} — refund {agent.address} to resume.")
            return
        topic = pick_topic(openai)
        print(f"[tick {tick}] topic={topic!r}")
        search = paid_search(agent, topic)
        summary = paid_inference(
            agent,
            f"Summarize these Exa search hits in 3 bullets:\n{search}\n",
        )
        print(f"[tick {tick}] SUMMARY:\n{summary}\n")
        time.sleep(TICK_SECONDS)


if __name__ == "__main__":
    main()
