import type { ToolContext } from "../server.js";

export function payableFetchTool() {
  return {
    name: "payable_fetch",
    description:
      "Fetch a URL that may require payment (HTTP 402). The agent automatically " +
      "detects the x402 facilitator flavor, signs a payment, and retries. Returns " +
      "the response status, headers, and body. Use this whenever an external " +
      "service charges per-call and you want to pay autonomously.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL (https)." },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          default: "GET",
        },
        body: {
          type: "string",
          description:
            "Request body (string). Set Content-Type via headers if non-JSON.",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Extra request headers.",
        },
        max_amount_usd: {
          type: "number",
          description:
            "Refuse to pay if the facilitator wants more than this. " +
            "Defaults to AIFINPAY_MAX_USD env or no cap.",
        },
        facilitator: {
          type: "string",
          description:
            "Force a facilitator: 'aifinpay' | 'coinbase-x402'. Default 'auto'.",
        },
      },
      required: ["url"],
    },
  };
}

export async function runPayableFetch(
  ctx: ToolContext,
  args: Record<string, unknown>,
) {
  const url = String(args.url ?? "");
  if (!url) return errorResult("missing required arg: url");
  const method = String(args.method ?? "GET").toUpperCase();
  const body = args.body ? String(args.body) : undefined;
  const headers =
    typeof args.headers === "object" && args.headers !== null
      ? (args.headers as Record<string, string>)
      : undefined;

  const maxAmountUsd =
    typeof args.max_amount_usd === "number"
      ? args.max_amount_usd
      : ctx.config.maxAmountUsd;

  try {
    const resp = await ctx.agent.pay(url, {
      method,
      body,
      headers,
      options: {
        maxAmountUsd,
        facilitator: typeof args.facilitator === "string"
          ? (args.facilitator as string)
          : undefined,
      },
    });

    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k] = v));
    const text = await resp.text();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: resp.status,
              ok: resp.ok,
              headers: respHeaders,
              body: text,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (e) {
    const err = e as Error;
    return errorResult(
      `${err.constructor.name}: ${err.message}`,
      `Tip: ensure agent ${ctx.agent.address} has a funded Seat PDA. ` +
        `Read more: https://aifinpay.company/docs`,
    );
  }
}

function errorResult(...lines: string[]) {
  return {
    isError: true,
    content: lines.map((line) => ({ type: "text", text: line })),
  };
}
