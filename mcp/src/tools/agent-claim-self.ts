import type { ToolContext } from "../server.js";

/**
 * `agent_claim_self` — agent attaches itself to a user's AiFinPay account
 * autonomously by signing a claim challenge with its own key.
 *
 * Flow (executed inside the tool, no copy-paste between UIs):
 *   1. User signs in to /login on aifinpay.company → gets a magic-link
 *      email with URL like `https://aifinpay.company/api/auth/verify?token=…`
 *   2. User pastes that URL to the agent: "claim yourself on my account
 *      using this magic link"
 *   3. Agent calls this tool with the magic_link_url
 *   4. Tool hits the magic link → server issues session cookie
 *   5. Tool POSTs to /api/me/agents/challenge with the agent's EVM address
 *   6. Tool signs the returned message with the agent's EVM key (EIP-191)
 *   7. Tool POSTs to /api/me/agents/claim → server verifies signature →
 *      agent attached to user's watchlist
 *
 * Optional `label` field gives the agent a friendly name in the user's UI.
 *
 * Security model:
 *   - Magic-link URL is one-shot, 15-min TTL, identifies the user
 *   - Signature proves the agent holds the EVM private key
 *   - Combination: "this user OWNS this agent". Either alone is
 *     insufficient (signature alone can't pick an account; magic link
 *     alone can't prove key control).
 */
export function agentClaimSelfTool() {
  return {
    name: "agent_claim_self",
    description:
      "Attach this agent to a user's AiFinPay account autonomously. " +
      "Requires a magic-link URL the user got after signing in at " +
      "https://aifinpay.company/login. The tool will use the link to " +
      "establish a session, request a claim challenge for this agent's " +
      "EVM address, sign it with the agent's key, and submit the proof. " +
      "After this completes, the user's /me page lists this agent and " +
      "they can view its activity at /agents/<evm-address>.",
    inputSchema: {
      type: "object",
      properties: {
        magic_link_url: {
          type: "string",
          description:
            "The URL the user received in the sign-in email. Looks like " +
            "https://aifinpay.company/api/auth/verify?token=… — one-shot, " +
            "expires 15 minutes after the user requested it.",
        },
        label: {
          type: "string",
          description: "Optional human-friendly label (e.g. 'claude-research-bot').",
        },
      },
      required: ["magic_link_url"],
    },
  };
}

export async function runAgentClaimSelf(
  ctx: ToolContext,
  args: Record<string, unknown>,
) {
  const magicLinkUrl = typeof args.magic_link_url === "string" ? args.magic_link_url : "";
  const label = typeof args.label === "string" ? args.label : null;

  if (!magicLinkUrl || !magicLinkUrl.includes("/api/auth/verify?token=")) {
    return {
      isError: true,
      content: [{ type: "text", text: "magic_link_url required — should look like https://aifinpay.company/api/auth/verify?token=…" }],
    };
  }

  // Derive API base from the magic link itself so demo can run against
  // staging / localhost without extra config.
  let apiBase: string;
  try {
    const u = new URL(magicLinkUrl);
    apiBase = `${u.protocol}//${u.host}`;
  } catch {
    return {
      isError: true,
      content: [{ type: "text", text: "magic_link_url is not a valid URL" }],
    };
  }

  // ── 1. Establish session by hitting the magic link ─────────────────
  let setCookie: string | null = null;
  try {
    const res = await fetch(magicLinkUrl, { redirect: "manual" });
    setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      return {
        isError: true,
        content: [{ type: "text", text: `Magic link did not return a session cookie (HTTP ${res.status}). Link may be expired or already used.` }],
      };
    }
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to fetch magic link: ${(e as Error).message}` }],
    };
  }
  // Some setups split multiple cookies; grab the session one we care about.
  const cookieHeader = setCookie.split(",").map((c) => c.trim().split(";")[0]).join("; ");

  // ── 2. Request a claim challenge for the EVM address ───────────────
  const evmAddr = ctx.agent.evmAddress;
  let challenge: { challenge_id: string; message: string };
  try {
    const r = await fetch(`${apiBase}/api/me/agents/challenge`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ address: evmAddr }),
    });
    const j = (await r.json()) as { error?: string; challenge_id?: string; message?: string };
    if (!r.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Challenge request failed (${r.status}): ${j.error || JSON.stringify(j)}` }],
      };
    }
    if (!j.challenge_id || !j.message) {
      return {
        isError: true,
        content: [{ type: "text", text: `Challenge response missing challenge_id/message: ${JSON.stringify(j)}` }],
      };
    }
    challenge = { challenge_id: j.challenge_id, message: j.message };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Failed to fetch challenge: ${(e as Error).message}` }],
    };
  }

  // ── 3. Sign the challenge with the agent's EVM key (EIP-191) ───────
  let signature: string;
  try {
    signature = await ctx.agent.evmAccount.signMessage({ message: challenge.message });
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Signing failed: ${(e as Error).message}` }],
    };
  }

  // ── 4. Submit the claim ────────────────────────────────────────────
  try {
    const r = await fetch(`${apiBase}/api/me/agents/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        signature,
        label,
      }),
    });
    const j = (await r.json()) as { error?: string };
    if (!r.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Claim submission failed (${r.status}): ${j.error || JSON.stringify(j)}` }],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            agent_address: evmAddr,
            chain: "polygon",
            label: label || null,
            next: `Visit ${apiBase}/agents/${evmAddr} to see live activity, or ${apiBase}/me for the full watchlist.`,
          }, null, 2),
        },
      ],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Claim POST failed: ${(e as Error).message}` }],
    };
  }
}
