/**
 * @aifinpay/mcp — MCP server exposing AiFinPay's autonomous x402 payment
 * loop as agent-callable tools.
 *
 * Tools:
 *   - agent_address()                    — return Solana + EVM addresses to fund
 *   - agent_call(provider, body)         — registry-resolved paid call (Polygon settle)
 *   - payable_fetch(url, opts?)          — raw-URL paid fetch (legacy Solana path)
 *   - agent_quote(url)                   — inspect 402 cost before paying
 *   - pay_with_split / quote_split       — direct B2BSplitter invoice (advanced)
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
 *   const { server } = await createServer({ agentSecretB58: process.env.SECRET });
 *   await server.connect(new StdioServerTransport());
 */
export { createServer } from "./server.js";
export type { ToolContext } from "./server.js";
export type { McpConfig } from "./config.js";
export { loadConfigFromEnv } from "./config.js";
