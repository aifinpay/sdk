"""
AiFinPayAgent — unified, chain-opaque developer surface (Phase 1+).

Mirrors `@aifinpay/agent`'s `AiFinPayAgent` TypeScript class. One seed
derives BOTH a Solana base58 pubkey AND a Polygon EVM 0x address.
Per-call payment via `agent.call(provider=…)` does:

  1. Registry lookup at /api/providers
  2. POST to the bridge → expect HTTP 402
  3. Build + sign + send the on-chain payment:
       - Polygon  → B2BSplitter.payMatic(merchant, ipCreator, orderId)
                    with msg.value = total_wei
       - Solana   → b2b_pay_with_split(merchant_amount_lamports, order_id)
                    on program 5g9zWHF1…KFx2
  4. Retry the bridge POST with x-tx-hash + x-order-id (Polygon) or
     x-solana-tx + x-order-id (Solana)
  5. Return the upstream response body

Dependencies (declared in pyproject.toml):
  • PyNaCl, base58   (already there)
  • web3, eth-account, eth-utils  (Polygon EVM)
  • solders          (Solana tx building)
"""

from __future__ import annotations

import hashlib
import os
import struct
import time
from dataclasses import dataclass
from typing import Any, Optional

import nacl.signing
import nacl.encoding
import base58
import requests

from .errors import AiFinPayError, X402Error
from .client import Agent  # legacy Solana-only agent (we wrap it)

# ── EVM imports — heavyish, lazy via top-level so missing deps fail clearly ──
try:
    from eth_account import Account as EvmAccount
    from web3 import Web3
    from web3.middleware import geth_poa_middleware
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "AiFinPayAgent requires web3 + eth_account. "
        "Install with: pip install 'aifinpay-agent[unified]' "
        "or: pip install web3 eth-account"
    ) from e

# ── Solana imports — solders for tx building, nacl already in deps ──
try:
    from solders.pubkey import Pubkey as SolPubkey
    from solders.keypair import Keypair as SolKeypair
    from solders.instruction import Instruction, AccountMeta
    from solders.system_program import ID as SYSTEM_PROGRAM_ID
    from solders.transaction import Transaction as SolTransaction
    from solders.message import Message as SolMessage
    from solders.hash import Hash as SolHash
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "AiFinPayAgent requires solders. "
        "Install with: pip install 'aifinpay-agent[unified]' or: pip install solders"
    ) from e


# ── Constants ───────────────────────────────────────────────────────────────

DEFAULT_REGISTRY_URL = "https://api.aifinpay.company/api/providers"
DEFAULT_POLYGON_RPC  = "https://polygon.drpc.org"
DEFAULT_SOLANA_RPC   = "https://api.mainnet-beta.solana.com"

# Polygon B2BSplitter.payMatic ABI (single-function slice — full ABI not needed)
SPLITTER_PAY_MATIC_ABI = [{
    "type": "function",
    "name": "payMatic",
    "stateMutability": "payable",
    "inputs": [
        {"type": "address", "name": "merchant"},
        {"type": "address", "name": "ipCreator"},
        {"type": "string",  "name": "orderId"},
    ],
    "outputs": [],
}]

# Anchor convention: discriminator = sha256("global:<fn_name>")[:8]
B2B_PAY_WITH_SPLIT_DISC = hashlib.sha256(b"global:b2b_pay_with_split").digest()[:8]


# ── Provider / Challenge types (lightweight, dict-backed) ──────────────────

@dataclass
class ProviderEntry:
    name:             str
    service_type:     Optional[str]
    bridge_url:       Optional[str]
    price_usd:        Optional[float]
    preferred_chain:  str = "polygon"

    @classmethod
    def from_dict(cls, d: dict) -> "ProviderEntry":
        return cls(
            name            = d.get("name", ""),
            service_type    = d.get("service_type"),
            bridge_url      = d.get("bridge_url"),
            price_usd       = d.get("price_usd"),
            preferred_chain = d.get("preferred_chain", "polygon"),
        )


# ── Main class ──────────────────────────────────────────────────────────────

class AiFinPayAgent:
    """
    Unified, chain-opaque agent. Wraps the legacy Solana `Agent` and adds
    an EVM signer + high-level `call()` that selects + settles per call.
    """

    inner:        Agent
    evm_account:  Any            # eth_account.LocalAccount
    sol_keypair:  SolKeypair
    registry_url: str
    polygon_rpc:  str
    solana_rpc:   str

    # ── Constructors ────────────────────────────────────────────────────────

    def __init__(self, inner: Agent, evm_private_key_hex: str, *,
                 registry_url: Optional[str] = None,
                 polygon_rpc:  Optional[str] = None,
                 solana_rpc:   Optional[str] = None,
                 base_url:     Optional[str] = None):
        self.inner       = inner
        self.evm_account = EvmAccount.from_key(evm_private_key_hex)
        self.sol_keypair = SolKeypair.from_seed(
            nacl.signing.SigningKey(
                base58.b58decode(inner.secret_b58)[:32]
            ).encode(),
        )
        self.registry_url = registry_url or os.environ.get(
            "AIFINPAY_REGISTRY_URL",
            (base_url or "https://api.aifinpay.company").rstrip("/") + "/api/providers",
        )
        self.polygon_rpc = polygon_rpc or os.environ.get("AIFINPAY_POLYGON_RPC", DEFAULT_POLYGON_RPC)
        self.solana_rpc  = solana_rpc  or os.environ.get("AIFINPAY_SOLANA_RPC",  DEFAULT_SOLANA_RPC)
        self._w3: Optional[Web3] = None
        self._registry_cache: Optional[list[ProviderEntry]] = None

    @classmethod
    def new(cls, **kwargs) -> "AiFinPayAgent":
        """Fresh dual-chain identity: random Solana keypair + random EVM key."""
        inner = Agent.new()
        evm_pk = "0x" + os.urandom(32).hex()
        return cls(inner, evm_pk, **kwargs)

    @classmethod
    def from_seed(cls, seed_hex: str, **kwargs) -> "AiFinPayAgent":
        """
        Derive both keypairs from one 32-byte hex seed.
          Solana key = nacl.sign.keyPair.fromSeed(seed)
          EVM key    = keccak256(seed)[:32]
        Independent paths — NOT BIP-44. Matches the Node SDK behavior.
        """
        from Crypto.Hash import keccak  # type: ignore
        seed = bytes.fromhex(seed_hex.removeprefix("0x"))
        if len(seed) != 32:
            raise AiFinPayError(f"seed must be 32 bytes, got {len(seed)}")
        signing = nacl.signing.SigningKey(seed)
        # secret_b58 is 64 bytes (secret + public) per tweetnacl convention
        secret_64 = signing.encode() + signing.verify_key.encode()
        inner = Agent.from_secret_b58(base58.b58encode(secret_64).decode())
        evm_seed = keccak.new(digest_bits=256).update(seed).digest()
        return cls(inner, "0x" + evm_seed.hex(), **kwargs)

    @classmethod
    def from_solana_secret(cls, secret_b58: str, *, evm_private_key: Optional[str] = None,
                            **kwargs) -> "AiFinPayAgent":
        inner = Agent.from_secret_b58(secret_b58)
        evm_pk = evm_private_key or ("0x" + os.urandom(32).hex())
        return cls(inner, evm_pk, **kwargs)

    # ── Identity ───────────────────────────────────────────────────────────

    @property
    def id(self) -> str:
        """Canonical identity — Solana pubkey (for back-compat with the leaderboard)."""
        return self.inner.address

    @property
    def solana_address(self) -> str:
        return self.inner.address

    @property
    def evm_address(self) -> str:
        return self.evm_account.address

    # ── Registry ──────────────────────────────────────────────────────────

    def fetch_registry(self, force: bool = False) -> list[ProviderEntry]:
        if self._registry_cache and not force:
            return self._registry_cache
        r = requests.get(self.registry_url, timeout=10)
        r.raise_for_status()
        data = r.json()
        providers = data.get("providers", [])
        self._registry_cache = [ProviderEntry.from_dict(p) for p in providers]
        return self._registry_cache

    def resolve_provider(self, name: str) -> ProviderEntry:
        for p in self.fetch_registry():
            if p.name == name:
                return p
        # Refresh once before giving up — registry may have new entries.
        self._registry_cache = None
        for p in self.fetch_registry():
            if p.name == name:
                return p
        raise AiFinPayError(f"Provider {name!r} not in registry at {self.registry_url}")

    # ── Lazy clients ──────────────────────────────────────────────────────

    def _web3(self) -> Web3:
        if self._w3 is None:
            w3 = Web3(Web3.HTTPProvider(self.polygon_rpc, request_kwargs={"timeout": 30}))
            try:
                w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            except Exception:
                pass
            self._w3 = w3
        return self._w3

    # ── Public: chain-opaque call ─────────────────────────────────────────

    def call(self, provider: str, body: Optional[dict] = None, *,
             method: str = "POST", chain: Optional[str] = None,
             cost: Optional[float] = None, timeout: float = 60.0) -> requests.Response:
        """
        Make a paid call to a registered provider. Returns the upstream
        Response after the on-chain settlement has been confirmed.

        :param provider: Registry name ("exa", "io-net", "venice", …)
        :param body: JSON-serializable body forwarded to the bridge
        :param method: HTTP method (default POST)
        :param chain: Force a chain ("polygon" | "solana"). Defaults to
                      provider.preferred_chain or Polygon.
        :param cost: Soft override of the registry price (used as budget cap
                     hint — bridges quote the actual price in the 402).
        :param timeout: HTTP timeout per request, seconds.
        """
        p = self.resolve_provider(provider)
        url = p.bridge_url
        if not url:
            raise AiFinPayError(f"Provider {provider!r} has no bridge_url")

        path = {
            "search":    "/search",
            "inference": "/chat/completions",
            "compute":   "/run",
            "analytics": "/query",
        }.get(p.service_type or "", "/")
        full_url = url.rstrip("/") + path

        picked_chain = (chain or p.preferred_chain or "polygon").lower()

        # 1. Initial unauthenticated POST → expect 402
        init_resp = requests.request(
            method, full_url,
            json=body if body is not None else None,
            timeout=timeout,
            headers={"content-type": "application/json"},
        )
        if init_resp.status_code != 402:
            # Bridge didn't ask for payment — pass through.
            return init_resp

        try:
            challenge = init_resp.json()
        except Exception:
            raise X402Error("bridge returned 402 with non-JSON body")

        if picked_chain == "solana":
            return self._settle_solana(full_url, challenge, method, body, timeout)
        return self._settle_polygon(full_url, challenge, method, body, timeout)

    # ── Polygon settlement ─────────────────────────────────────────────────

    def _settle_polygon(self, full_url: str, challenge: dict, method: str,
                        body: Optional[dict], timeout: float) -> requests.Response:
        pm = challenge.get("pay_matic")
        if not pm:
            raise X402Error(
                "bridge returned 402 but no pay_matic block — "
                "use chain='solana' if the bridge supports it, or use the "
                "legacy generic facilitator client for non-AiFinPay 402s."
            )

        w3 = self._web3()
        splitter = w3.eth.contract(
            address=Web3.to_checksum_address(pm["splitter"]),
            abi=SPLITTER_PAY_MATIC_ABI,
        )
        merchant = Web3.to_checksum_address(pm["merchant_wallet"])
        ip_creator = "0x" + "00" * 20
        order_id = pm["order_id"]
        total_wei = int(pm["total_wei"])

        nonce = w3.eth.get_transaction_count(self.evm_address)
        gas_price = w3.eth.gas_price
        tx = splitter.functions.payMatic(merchant, ip_creator, order_id).build_transaction({
            "from":     self.evm_address,
            "value":    total_wei,
            "nonce":    nonce,
            "gasPrice": gas_price,
            "chainId":  137,  # Polygon mainnet
        })
        # Estimate gas with a small buffer
        try:
            gas_est = w3.eth.estimate_gas(tx)
            tx["gas"] = int(gas_est * 1.2)
        except Exception:
            tx["gas"] = 300_000  # safe default

        signed = w3.eth.account.sign_transaction(tx, self.evm_account.key)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt.status != 1:
            raise AiFinPayError(f"Polygon tx reverted: {tx_hash.hex()}")

        # Retry the bridge with payment proof
        paid_resp = requests.request(
            method, full_url,
            json=body if body is not None else None,
            timeout=timeout,
            headers={
                "content-type": "application/json",
                "x-tx-hash":    tx_hash.hex(),
                "x-order-id":   order_id,
            },
        )
        if not paid_resp.ok:
            raise AiFinPayError(
                f"Bridge retry failed {paid_resp.status_code} after on-chain payment "
                f"{tx_hash.hex()}: {paid_resp.text[:300]}"
            )
        return paid_resp

    # ── Solana settlement (b2b_pay_with_split) ───────────────────────────

    def _settle_solana(self, full_url: str, challenge: dict, method: str,
                       body: Optional[dict], timeout: float) -> requests.Response:
        ps = challenge.get("pay_solana")
        if not ps:
            raise X402Error(
                f"bridge returned 402 without a pay_solana block — operator has not "
                f"set BRIDGE_MERCHANT_SOLANA. Use chain='polygon' instead."
            )

        program_id = SolPubkey.from_string(ps["program_id"])
        merchant   = SolPubkey.from_string(ps["merchant_wallet"])
        treasury   = SolPubkey.from_string(ps["treasury"])
        ip_creator = treasury  # default routing; future: per-merchant slot
        order_id   = ps["order_id"]
        merchant_amount_lamports = int(ps["merchant_amount_lamports"])

        # PDAs derived from program_id with seeds ["config"] and ["vault"]
        config_pda, _ = SolPubkey.find_program_address([b"config"], program_id)
        vault_pda,  _ = SolPubkey.find_program_address([b"vault"],  program_id)

        # Instruction data: discriminator + Borsh(u64 + string)
        order_bytes = order_id.encode("utf-8")
        if len(order_bytes) > 64:
            raise AiFinPayError(f"order_id too long ({len(order_bytes)} bytes > 64)")
        data = (
            B2B_PAY_WITH_SPLIT_DISC
            + struct.pack("<Q", merchant_amount_lamports)
            + struct.pack("<I", len(order_bytes))
            + order_bytes
        )

        agent_pubkey = self.sol_keypair.pubkey()
        keys = [
            AccountMeta(pubkey=config_pda,            is_signer=False, is_writable=False),
            AccountMeta(pubkey=vault_pda,             is_signer=False, is_writable=False),
            AccountMeta(pubkey=agent_pubkey,          is_signer=True,  is_writable=True),
            AccountMeta(pubkey=treasury,              is_signer=False, is_writable=True),
            AccountMeta(pubkey=ip_creator,            is_signer=False, is_writable=True),
            AccountMeta(pubkey=merchant,              is_signer=False, is_writable=True),
            AccountMeta(pubkey=SolPubkey.from_string(str(SYSTEM_PROGRAM_ID)), is_signer=False, is_writable=False),
        ]
        ix = Instruction(program_id=program_id, accounts=keys, data=data)

        # Fetch recent blockhash + submit
        rpc_req = lambda payload: requests.post(self.solana_rpc, json=payload, timeout=timeout).json()
        bh_resp = rpc_req({"jsonrpc": "2.0", "id": 1, "method": "getLatestBlockhash",
                           "params": [{"commitment": "confirmed"}]})
        blockhash = SolHash.from_string(bh_resp["result"]["value"]["blockhash"])

        msg = SolMessage.new_with_blockhash([ix], agent_pubkey, blockhash)
        tx  = SolTransaction([self.sol_keypair], msg, blockhash)

        send_resp = rpc_req({"jsonrpc": "2.0", "id": 1, "method": "sendTransaction",
                             "params": [bytes(tx).hex(), {"encoding": "hex", "preflightCommitment": "confirmed"}]})
        if "error" in send_resp:
            raise AiFinPayError(f"Solana send failed: {send_resp['error']}")
        tx_sig = send_resp["result"]

        # Wait for confirmation (poll up to ~30s)
        deadline = time.time() + 30
        confirmed = False
        while time.time() < deadline:
            time.sleep(2)
            st = rpc_req({"jsonrpc": "2.0", "id": 1, "method": "getSignatureStatuses",
                          "params": [[tx_sig], {"searchTransactionHistory": True}]})
            value = (st.get("result", {}) or {}).get("value", [None])[0]
            if value and value.get("confirmationStatus") in ("confirmed", "finalized"):
                if value.get("err") is not None:
                    raise AiFinPayError(f"Solana tx errored: {value['err']}")
                confirmed = True
                break
        if not confirmed:
            raise AiFinPayError(f"Solana tx {tx_sig} not confirmed within 30s")

        paid_resp = requests.request(
            method, full_url,
            json=body if body is not None else None,
            timeout=timeout,
            headers={
                "content-type": "application/json",
                "x-solana-tx":  tx_sig,
                "x-order-id":   order_id,
            },
        )
        if not paid_resp.ok:
            raise AiFinPayError(
                f"Bridge retry failed {paid_resp.status_code} after Solana payment "
                f"{tx_sig}: {paid_resp.text[:300]}"
            )
        return paid_resp
