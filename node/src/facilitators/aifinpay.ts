import nacl from "tweetnacl";
import bs58 from "bs58";
import type { Agent } from "../agent.js";
import { sha256 } from "../crypto.js";
import type { AuthPayload, Facilitator, PayOptions } from "./base.js";

/**
 * Native AiFinPay flavor.
 *
 * Wire format:
 *   - 402 carries a JSON body with `protocol: "AiFinPay vX"` and
 *     `agreement_hash`, `treasury_vault`, `x-nonce` …
 *   - Client retries with three headers:
 *       x-agent-pubkey, x-nonce, x-signature
 *   - Signature: Ed25519 over SHA-256("AiFinPay-x402:{nonce}:{pubkey}")
 */
export class AiFinPayFacilitator implements Facilitator {
  static readonly name = "aifinpay";
  readonly name = "aifinpay";

  static async detect(resp: Response): Promise<boolean> {
    if (resp.status !== 402) return false;
    let body: unknown;
    try {
      body = await resp.clone().json();
    } catch {
      return false;
    }
    if (typeof body !== "object" || body === null) return false;
    const b = body as Record<string, unknown>;
    if (typeof b.protocol === "string" && b.protocol.startsWith("AiFinPay")) {
      return true;
    }
    // Fallback fingerprint when an upstream proxy strips `protocol`.
    return (
      ("agreement_hash" in b || "manifesto" in b) &&
      ("treasury_vault" in b || "program_id" in b)
    );
  }

  async buildAuth(
    resp: Response,
    agent: Agent,
    _opts: PayOptions,
  ): Promise<AuthPayload> {
    const nonce =
      (await this.inbandNonce(resp)) || (await this.fetchNonce(agent));
    const msg = new TextEncoder().encode(
      `AiFinPay-x402:${nonce}:${agent.address}`,
    );
    const digest = await sha256(msg);
    const sig = nacl.sign.detached(digest, agent.secretKey);
    return {
      headers: {
        "x-agent-pubkey": agent.address,
        "x-nonce": nonce,
        "x-signature": bs58.encode(sig),
      },
    };
  }

  private async inbandNonce(resp: Response): Promise<string | null> {
    let body: unknown;
    try {
      body = await resp.clone().json();
    } catch {
      return null;
    }
    if (typeof body !== "object" || body === null) return null;
    const b = body as Record<string, unknown>;
    const candidate = b["x-nonce"] ?? b["nonce"];
    return typeof candidate === "string" && candidate ? candidate : null;
  }

  private async fetchNonce(agent: Agent): Promise<string> {
    const r = await agent.fetchImpl(`${agent.baseUrl}/nonce`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`/nonce → ${r.status}`);
    const json = (await r.json()) as { nonce?: string };
    if (!json.nonce) throw new Error("/nonce: missing 'nonce' field");
    return json.nonce;
  }
}
