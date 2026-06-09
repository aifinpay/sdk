"""Native AiFinPay flavor — three custom headers, JSON body in the 402."""
from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

import base58
import requests

from .base import Facilitator, PayOptions

if TYPE_CHECKING:
    from ..client import Agent


class AiFinPayFacilitator:
    """Adapter for the AiFinPay native x402 flow.

    Wire format:
        - 402 carries a JSON body with `program_id`, `manifesto`,
          `agreement_hash`, `treasury_vault`, …
        - Client retries with three headers:
            x-agent-pubkey, x-nonce, x-signature
        - Signature: Ed25519 over SHA-256("AiFinPay-x402:{nonce}:{pubkey}")
    """

    name = "aifinpay"

    @staticmethod
    def detect(resp: requests.Response) -> bool:
        if resp.status_code != 402:
            return False
        try:
            body = resp.json()
        except ValueError:
            return False
        if not isinstance(body, dict):
            return False
        # AiFinPay 402 carries `protocol: "AiFinPay vX.Y"` plus either
        # `agreement_hash` (most common) or `manifesto` ref.
        protocol = body.get("protocol", "")
        if isinstance(protocol, str) and protocol.startswith("AiFinPay"):
            return True
        # Fallback fingerprint when an upstream proxy strips `protocol`.
        return ("agreement_hash" in body or "manifesto" in body) and (
            "treasury_vault" in body or "program_id" in body
        )

    def __init__(self, base_url: str = "https://aifinpay.io", timeout: int = 30):
        # base_url is needed to fetch a fresh nonce. Defaults to the
        # canonical AiFinPay backend; can be pointed at a self-hosted
        # facilitator in tests.
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _fetch_nonce(self, session: requests.Session) -> str:
        r = session.get(f"{self.base_url}/nonce", timeout=self.timeout)
        r.raise_for_status()
        return r.json()["nonce"]

    @staticmethod
    def _sign_nonce(agent: "Agent", nonce: str) -> str:
        msg = f"AiFinPay-x402:{nonce}:{agent.address}".encode()
        digest = hashlib.sha256(msg).digest()
        sig = agent._sk.sign(digest).signature
        return base58.b58encode(sig).decode()

    def build_auth(
        self,
        resp: requests.Response,
        agent: "Agent",
        opts: PayOptions,
    ) -> dict:
        # AiFinPay 402 means the agent has no live Seat PDA. The SDK
        # cannot transparently "pay" — that requires submitting an
        # on-chain reserve_seat tx through Solana. We sign whatever
        # nonce the server gave us; if the server still 402s after that,
        # the caller must fund a Seat first.
        nonce = self._inband_nonce(resp) or self._fetch_nonce(agent._session)
        headers = {
            "x-agent-pubkey": agent.address,
            "x-nonce": nonce,
            "x-signature": self._sign_nonce(agent, nonce),
        }
        return {"headers": headers}

    @staticmethod
    def _inband_nonce(resp: requests.Response) -> str | None:
        """Return the nonce the server included inside the 402 body, if any.

        Saves a round-trip vs. always GETting /nonce.
        """
        try:
            body = resp.json()
        except ValueError:
            return None
        if not isinstance(body, dict):
            return None
        candidate = body.get("x-nonce") or body.get("nonce")
        return candidate if isinstance(candidate, str) and candidate else None
