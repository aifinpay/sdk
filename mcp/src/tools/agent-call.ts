import type { ToolContext } from "../server.js";

/**
 * `agent_call` — unified registry-resolved paid HTTP call.
 *
 * The agent picks a provider by name ("exa", "io-net", "venice", …),
 * the SDK looks up the bridge URL + price from the public AiFinPay
 * registry, negotiates the 402 challenge, settles on Polygon via
 * B2BSplitter.payMatic, retries with proof, and returns the upstream
 * response body.
 *
 * Use this in preference to `payable_fetch` when you have a registered
 * provider name — it auto-routes price, chain, and bridge URL.
 *
 * Requires the EVM address (from `agent_address`) to be funded with POL
 * on Polygon mainnet (gas + payment), or USDC if the provider quotes in
 * stablecoin.
 */
export function agentCallTool() {
  return {
    name: "agent_call",
    description:
      "Make a paid call to any AiFinPay-registered provider by name. " +
      "Provider names come from https://aifinpay.company/api/providers — " +
      "currently 'exa' (search), 'io-net' (Llama-3.3-70B inference), " +
      "'venice' (image generation), more added per partner integration. " +
      "Body is the provider-specific request (e.g. {messages:[...]} for " +
      "io-net, {query:'...'} for exa). Returns the full upstream response. " +
      "Settlement: Polygon mainnet, atomic 99/1 split via B2BSplitter.",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          description: "Registered provider name. Example: 'io-net', 'exa', 'venice'.",
        },
        body: {
          type: "object",
          description: "Provider-specific request body. Forwarded to the bridge after payment.",
          additionalProperties: true,
        },
        method: {
          type: "string",
          enum: ["GET", "POST"],
          default: "POST",
          description: "HTTP method. Defaults to POST (matches all current providers).",
        },
        cost: {
          type: "number",
          description: "Optional override of the registry-quoted price (USD). Use to enforce a stricter budget cap.",
        },
      },
      required: ["provider"],
    },
  };
}

export async function runAgentCall(
  ctx: ToolContext,
  args: Record<string, unknown>,
) {
  const provider = args.provider as string | undefined;
  const body     = args.body     as Record<string, unknown> | undefined;
  const method   = (args.method  as "GET" | "POST" | undefined) ?? "POST";
  const cost     = args.cost     as number | undefined;

  if (!provider) {
    return {
      isError: true,
      content: [{ type: "text", text: "`provider` is required (e.g. 'exa', 'io-net')" }],
    };
  }

  try {
    const resp = await ctx.agent.call({
      provider,
      body,
      method,
      cost,
    });
    if (resp === null) {
      return {
        isError: true,
        content: [{ type: "text", text: "Call skipped — budget cap exceeded (on_limit_exceeded='skip')." }],
      };
    }
    const text = await resp.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep as text */ }

    // Pull the @internal settlement metadata attached by AiFinPayAgent.call
    // (see unifiedAgent.ts). Surfacing the tx hash here lets the agent show
    // a clickable explorer link in chat without re-querying the chain.
    const meta = resp as unknown as { aifinpayTx?: string; aifinpayChain?: string };
    const txHash = meta.aifinpayTx;
    const txChain = meta.aifinpayChain;
    const txLine = txHash
      ? `Paid on ${txChain ?? "polygon"}. Tx: ${txHash} → https://${txChain === "solana" ? "solscan.io/tx" : "polygonscan.com/tx"}/${txHash}\n\n`
      : "";

    const bodyText = typeof parsed === "string"
      ? parsed
      : JSON.stringify({ status: resp.status, body: parsed }, null, 2);

    return {
      content: [
        {
          type: "text",
          text: txLine + bodyText,
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint =
      message.toLowerCase().includes("budget")
        ? "Tip: increase the per-call cost cap or use `agent_quote` to preview before paying."
        : message.toLowerCase().includes("revert") || message.toLowerCase().includes("insufficient")
          ? `Tip: ensure the EVM address ${ctx.agent.evmAddress} holds enough POL on Polygon for gas + payment.`
          : `Provider may be misconfigured. Check https://aifinpay.company/api/providers.`;
    return {
      isError: true,
      content: [{ type: "text", text: `agent_call failed: ${message}\n\n${hint}` }],
    };
  }
}
