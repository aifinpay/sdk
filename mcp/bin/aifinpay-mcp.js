#!/usr/bin/env node
/**
 * stdio entry point — run `npx @aifinpay/mcp` to start the MCP server
 * in stdio mode. Compatible with Claude Desktop, MCP Inspector, and any
 * MCP-aware agent runtime.
 *
 * Configure via env:
 *   AIFINPAY_AGENT_SECRET   base58 secret (load existing identity)
 *   AIFINPAY_BASE_URL       default https://aifinpay.io
 *   AIFINPAY_TIMEOUT_MS     default 30000
 *   AIFINPAY_MAX_USD        hard cap per single payment (no default)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, loadConfigFromEnv } from "../dist/index.js";

const { server } = await createServer(loadConfigFromEnv());
const transport = new StdioServerTransport();
await server.connect(transport);
