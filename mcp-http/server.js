// ──────────────────────────────────────────────────────────────────────────
// @aifinpay/mcp-http — Streamable HTTP transport in front of @aifinpay/mcp
//
// Exposes the AiFinPay MCP server at a public URL so catalogs (Smithery,
// mcp.so, LobeHub MCP) that require an HTTP endpoint can list us. The
// underlying tools are the same as the stdio @aifinpay/mcp package —
// payable_fetch, agent_address, agent_quote, pay_with_split, quote_split.
//
// Per-session model: each MCP client connection gets its own ephemeral
// Agent identity unless the client passes ?secret=<base58> on the
// initialize request (DON'T do this from a browser — keys leak in logs).
//
// Run:
//   PORT=3010 node server.js
//
// Catalog URL: https://mcp.aifinpay.company/mcp
// ──────────────────────────────────────────────────────────────────────────
import express from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "@aifinpay/mcp/dist/server.js";

const PORT = process.env.PORT || 3010;
const PUBLIC_URL = process.env.MCP_PUBLIC_URL || "https://mcp.aifinpay.company/mcp";

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));

// Public catalog GET — lets Smithery/mcp.so crawlers see what we are
// without spawning a full MCP session.
app.get("/", (_req, res) =>
  res.json({
    server: "@aifinpay/mcp-http",
    protocol: "Model Context Protocol",
    transport: "Streamable HTTP",
    mcp_endpoint: PUBLIC_URL,
    description:
      "Pay-per-call MCP server. Five tools (payable_fetch, agent_address, agent_quote, pay_with_split, quote_split) let agents settle on-chain payments on Polygon and Solana mainnet.",
    install: {
      stdio_alternative: {
        package: "@aifinpay/mcp",
        command: "npx @aifinpay/mcp",
        note: "Local stdio version — preferred for Claude Desktop / Cursor / Windsurf when remote HTTP is overkill.",
      },
      http: {
        url: PUBLIC_URL,
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      },
    },
    tools: [
      { name: "payable_fetch", desc: "Fetch any URL; auto-pay on 402." },
      { name: "agent_address", desc: "Show the session's wallet address." },
      { name: "agent_quote",   desc: "Preview the cost of a paid URL." },
      { name: "pay_with_split", desc: "Settle a B2B payment through the splitter." },
      { name: "quote_split",   desc: "Compute the atomic 99/1 fee breakdown." },
    ],
    links: {
      site:    "https://aifinpay.company",
      docs:    "https://aifinpay.company/docs",
      sdk:     "https://github.com/AiFinPay/sdk",
      status:  "https://aifinpay.company/status",
      network: "https://aifinpay.company/network",
    },
  }),
);

// ── MCP session table ──────────────────────────────────────────────────
// Each MCP client (Smithery's catalog scrape, LobeChat invocation, etc)
// keeps its own server + transport keyed by the session id MCP issues
// during initialize.
const sessions = new Map(); // sessionId → { transport, server, agent }

const mcpLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: "rate_limit_exceeded" },
});

// Allow Cloudflare + nginx to surface real client IP without ipv6 noise.
function sessionLog(level, msg) {
  process.stderr.write(`[mcp-http] ${level}: ${msg}\n`);
}

app.post("/mcp", mcpLimiter, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    let session = sessionId ? sessions.get(sessionId) : null;

    // No session yet AND the request is an initialize → spin up a fresh server.
    if (!session && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, agent });
          sessionLog("info", `session init id=${id} agent=${agent.address}`);
        },
      });

      // Reap session on transport close.
      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
          sessionLog("info", `session close id=${transport.sessionId}`);
        }
      };

      // Build a fresh MCP server with an ephemeral agent for this session.
      // Operators / catalog crawlers don't need a funded address — they
      // only walk the tool list. End users connecting persistently can
      // pass AIFINPAY_AGENT_SECRET through their MCP client env (this
      // happens via the stdio path; the HTTP path is for listings).
      const { server, agent } = createServer({ logFn: sessionLog });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // Existing session — route to its transport.
    if (session) {
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32600, message: "Bad Request: no valid session and not an initialize request" },
      id: null,
    });
  } catch (err) {
    sessionLog("error", `unhandled: ${err?.message || err}`);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// SSE GET — server-to-client notifications channel.
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    return res.status(400).send("Invalid or missing session id");
  }
  await session.transport.handleRequest(req, res);
});

// DELETE /mcp — explicit session close.
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    return res.status(400).send("Invalid or missing session id");
  }
  await session.transport.handleRequest(req, res);
});

app.listen(PORT, () => {
  sessionLog("info", `listening on :${PORT}, public URL ${PUBLIC_URL}`);
});
