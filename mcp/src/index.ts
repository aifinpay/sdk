/**
 * @aifinpay/mcp — MCP server exposing AiFinPay's autonomous x402 payment
 * loop as agent-callable tools.
 *
 * Tools:
 *   - payable_fetch(url, opts?) — fetch any URL, auto-pay on 402
 *   - agent_address()           — show pubkey to fund
 *   - agent_quote(url)          — inspect 402 cost before paying
 *
 * Quick start (stdio transport for Claude Desktop / MCP-aware runtimes):
 *
 *   $ npx @aifinpay/mcp
 *
 * Or programmatically:
 *
 *   import { createServer } from "@aifinpay/mcp";
 *   import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
 *
 *   const { server } = createServer({ agentSecretB58: process.env.SECRET });
 *   await server.connect(new StdioServerTransport());
 */
export { createServer } from "./server.js";
export type { ToolContext } from "./server.js";
export type { McpConfig } from "./config.js";
export { loadConfigFromEnv } from "./config.js";
