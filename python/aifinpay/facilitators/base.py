"""Facilitator protocol — the abstract interface every adapter implements."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional, Protocol, runtime_checkable

import requests

if TYPE_CHECKING:
    from ..client import Agent


@dataclass
class PayOptions:
    """Caller-supplied controls for a `pay()` call.

    All fields are optional. The SDK applies sensible defaults.
    """

    max_amount_usd: Optional[float] = None
    """Refuse to pay if the facilitator requires more than this. None = no cap."""

    preferred_chain: Optional[str] = None
    """Hint for facilitators that accept multiple chains (e.g. 'solana', 'polygon')."""

    facilitator: str = "auto"
    """`auto` | `aifinpay` | `coinbase-x402`. Forces a specific adapter."""

    extra_headers: dict = field(default_factory=dict)
    """Extra headers to attach AFTER the facilitator's auth headers."""


@runtime_checkable
class Facilitator(Protocol):
    """A facilitator handles one x402 wire format.

    Implementations are usually stateless; state (keypair, base URL) lives on
    the Agent. The Facilitator just translates challenge → auth payload.
    """

    name: str

    @staticmethod
    def detect(resp: requests.Response) -> bool:
        """Return True if this facilitator is the right adapter for `resp`."""
        ...

    def build_auth(
        self,
        resp: requests.Response,
        agent: "Agent",
        opts: PayOptions,
    ) -> dict:
        """Return the kwargs to merge into the retry request.

        Returned dict typically contains:
            - "headers": dict of headers to set on the retry
            - optional "body": replacement body
            - optional "method": override method

        May raise:
            - PaymentTooExpensiveError if cost > opts.max_amount_usd
            - FacilitatorNotImplementedError if the facilitator is detected
              but we can't pay it yet (e.g. EVM wallet not wired)
        """
        ...
