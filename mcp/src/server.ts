import { Agent } from "@aifinpay/agent";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "./config.js";
import { payableFetchTool, runPayableFetch } from "./tools/payable-fetch.js";
import { agentAddressTool, runAgentAddress } from "./tools/agent-address.js";
import { agentQuoteTool, runAgentQuote } from "./tools/agent-quote.js";
import {
  payWithSplitTool,
  runPayWithSplit,
  quoteSplitTool,
  runQuoteSplit,
} from "./tools/pay-with-split.js";

/**
 * Build an MCP server that wraps the AiFinPay agent SDK as MCP tools.
 *
 * Returned server is unstarted — caller wires up a transport (stdio, SSE,
 * etc.) via the official `@modelcontextprotocol/sdk` package.
 */
export function createServer(config: McpConfig = {}) {
  const log = config.logFn ?? defaultLog;

  // Agent identity: load from env secret if provided, else generate one
  // and print to stderr so the human knows what to fund.
  const agent = config.agentSecretB58
    ? Agent.fromSecretB58(config.agentSecretB58, {
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
      })
    : (() => {
        const a = Agent.new({
          baseUrl: config.baseUrl,
          timeoutMs: config.timeoutMs,
        });
        log(
          "warn",
          `[aifinpay-mcp] no AIFINPAY_AGENT_SECRET set — generated EPHEMERAL agent.\n` +
            `  address: ${a.address}\n` +
            `  secret:  ${a.secretB58}\n` +
            `  >> Save this secret to AIFINPAY_AGENT_SECRET to keep the agent across restarts.`,
        );
        return a;
      })();

  log("info", `[aifinpay-mcp] agent address: ${agent.address}`);

  const server = new Server(
    {
      name: "@aifinpay/mcp",
      version: "0.1.0-alpha.2",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        payableFetchTool(),
        agentAddressTool(),
        agentQuoteTool(),
        payWithSplitTool(),
        quoteSplitTool(),
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const ctx = { agent, config, log };
    switch (name) {
      case "payable_fetch":
        return runPayableFetch(ctx, args ?? {});
      case "agent_address":
        return runAgentAddress(ctx, args ?? {});
      case "agent_quote":
        return runAgentQuote(ctx, args ?? {});
      case "pay_with_split":
        return runPayWithSplit(ctx, args ?? {});
      case "quote_split":
        return runQuoteSplit(ctx, args ?? {});
      default:
        return {
          isError: true,
          content: [
            { type: "text", text: `unknown tool: ${name}` },
          ],
        };
    }
  });

  return { server, agent };
}

export interface ToolContext {
  agent: Agent;
  config: McpConfig;
  log: (level: "info" | "warn" | "error", msg: string) => void;
}

function defaultLog(level: "info" | "warn" | "error", msg: string) {
  // MCP stdio servers MUST NOT write to stdout — the transport owns it.
  // stderr is safe.
  process.stderr.write(`[${level}] ${msg}\n`);
}
