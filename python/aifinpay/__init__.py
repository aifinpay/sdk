"""
AiFinPay agent SDK — non-custodial x402 payment client.

Quick start:

    from aifinpay import Agent

    agent = Agent.new()                 # generate fresh Ed25519 keypair locally
    print("Fund:", agent.address)

    # AiFinPay-native flow
    agent.wait_for_funding(min_usd_cents=100)
    invoice = agent.reserve_seat_invoice(amount_usd=1.00, asset="USDC")

    # Generic x402 — pays any supported facilitator
    resp = agent.pay("https://api.example.com/v1/data")

    # Convenience — same as pay() but pinned to GET / POST
    resp = agent.get("https://aifinpay.company/api/stats")
"""

from .client import Agent, Invoice
from .errors import (
    AiFinPayError,
    FacilitatorNotImplementedError,
    FundingTimeoutError,
    PaymentTooExpensiveError,
    SeatNotFoundError,
    UnsupportedFacilitatorError,
    X402Error,
)
from .facilitators import (
    AiFinPayFacilitator,
    CoinbaseX402Facilitator,
    Facilitator,
    PayOptions,
)

# Phase 1+ unified surface — at parity with @aifinpay/agent JS SDK.
# Lazy import so installs without the EVM/Solana extras keep working with
# the legacy Agent class.
def __getattr__(name: str):
    if name == "AiFinPayAgent":
        from .unified_agent import AiFinPayAgent as _A
        return _A
    raise AttributeError(name)

__version__ = "0.3.0a0"
__all__ = [
    "Agent",
    "AiFinPayAgent",
    "Invoice",
    "AiFinPayError",
    "FundingTimeoutError",
    "SeatNotFoundError",
    "X402Error",
    "UnsupportedFacilitatorError",
    "PaymentTooExpensiveError",
    "FacilitatorNotImplementedError",
    "PayOptions",
    "Facilitator",
    "AiFinPayFacilitator",
    "CoinbaseX402Facilitator",
]
