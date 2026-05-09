import type { ToolContext } from "../server.js";

export function agentAddressTool() {
  return {
    name: "agent_address",
    description:
      "Return the agent's Solana base58 public key (its on-chain identity). " +
      "Send funds to this address to enable payments via payable_fetch.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  };
}

export async function runAgentAddress(
  ctx: ToolContext,
  _args: Record<string, unknown>,
) {
  return {
    content: [
      {
        type: "text",
        text: ctx.agent.address,
      },
    ],
  };
}
