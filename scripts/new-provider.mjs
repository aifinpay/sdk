#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// new-provider — scaffold an AiFinPay marketplace provider in seconds.
//
// Generates a ready-to-run config for the generic-x402-bridge plus the
// services.json registry entry to paste into the backend. No bridge code is
// written or edited — the generic bridge is fully env-driven.
//
// Usage:
//   node scripts/new-provider.mjs \
//     --slug elevenlabs --name "ElevenLabs" --category speech \
//     --upstream-url https://api.elevenlabs.io/v1/text-to-speech \
//     --auth-style header --auth-header xi-api-key \
//     --route-path /audio/speech --price-usd 0.03 \
//     --url https://elevenlabs.io --tagline "Text-to-speech for agents"
//
// Output:
//   examples/<slug>-x402-bridge/.env        run config for the generic bridge
//   examples/<slug>-x402-bridge/README.md   run + go-live instructions
//   (prints the services.json registry entry to stdout)
// ──────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── arg parsing (--key value | --key=value | --flag) ──
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.slug || !args["upstream-url"]) {
  console.log(`scaffold a marketplace provider for the generic x402 bridge

required:
  --slug <slug>             machine slug, e.g. "elevenlabs"
  --upstream-url <url>      where to forward paid requests

common:
  --name <label>            human name (default: slug)
  --category <cat>          search | inference | compute | image | speech | data | tools | analytics
  --service-type <type>     defaults to --category
  --auth-style <style>      bearer (default) | x-api-key | header
  --auth-header <name>      header name when --auth-style header (e.g. xi-api-key)
  --route-path <path>       exposed/forwarded path (default /chat/completions)
  --require-field <name>    reject bodies missing this field (e.g. messages, query)
  --price-usd <n>           per-call price in USD (default 0.0105)
  --pol-usd <n>             POL/USD used to derive PRICE_WEI (default 0.45)
  --merchant <0x...>        merchant wallet (default AiFinPay treasury Safe)
  --port <n>                bridge port (default 3000)
  --url <url>               provider homepage
  --tagline <text>          one-line value prop
`);
  process.exit(args.help ? 0 : 1);
}

const slug         = String(args.slug).toLowerCase();
const name         = args.name || slug;
const category     = (args.category || "inference").toLowerCase();
const serviceType  = (args["service-type"] || category).toLowerCase();
const upstreamUrl  = String(args["upstream-url"]);
const authStyle    = (args["auth-style"] || "bearer").toLowerCase();
const authHeader   = args["auth-header"] || "authorization";
const routePath    = args["route-path"] || "/chat/completions";
const requireField = args["require-field"] || "";
const priceUsd     = Number(args["price-usd"] ?? 0.0105);
const polUsd       = Number(args["pol-usd"] ?? 0.45);
const merchant     = args.merchant || "0xD31d82c4b35DABaA2ad7023C89A78A052D1f3c8e";
const port         = Number(args.port ?? 3000);
const url          = args.url || "";
const tagline      = args.tagline || "";

if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
  console.error("--price-usd must be a positive number"); process.exit(1);
}

// Derive on-chain amounts from the USD price.
const priceWei   = BigInt(Math.round((priceUsd / polUsd) * 1e18)).toString();
const usdcUnits  = String(Math.round(priceUsd * 1e6));

const bridgeDir = path.join(ROOT, "examples", `${slug}-x402-bridge`);
fs.mkdirSync(bridgeDir, { recursive: true });

const envBody = `# Scaffolded by scripts/new-provider.mjs — run with the generic bridge:
#   node --env-file=.env ../_generic-x402-bridge/server.js
PORT=${port}
SERVICE_NAME=${slug}-x402-bridge
SERVICE_LABEL=${name}
SLUG=${slug}

UPSTREAM_URL=${upstreamUrl}
UPSTREAM_AUTH_STYLE=${authStyle}
UPSTREAM_AUTH_HEADER=${authHeader}
UPSTREAM_API_KEY=
ROUTE_PATH=${routePath}
REQUIRE_BODY_FIELD=${requireField}

PRICE_WEI=${priceWei}
PRICE_USDC_UNITS=${usdcUnits}
PRICE_USDT_UNITS=${usdcUnits}

BRIDGE_MERCHANT_WALLET=${merchant}
POLYGON_RPC=https://1rpc.io/matic
SPLITTER_ADDRESS_POLYGON=0xE34Fc0E6694821c600Fa0955C0F74720ea6d8440

BRIDGE_MERCHANT_SOLANA=
PRICE_LAMPORTS=100000
REDIS_URL=
`;
fs.writeFileSync(path.join(bridgeDir, ".env"), envBody);

const registryEntry = {
  name: slug,
  display_name: name,
  url: url || undefined,
  logo: slug,
  service_type: serviceType,
  category,
  tagline: tagline || undefined,
  modes: {
    bridge: {
      bridge_url: `https://bridge.aifinpay.io/${slug}`,
      chain: "polygon",
      merchant_wallet: merchant,
      price_usd: priceUsd,
    },
  },
};
const registrySnippet = JSON.stringify({ [slug]: registryEntry }, null, 2);

const readme = `# ${name} — AiFinPay x402 bridge (\`${slug}\`)

Scaffolded for the env-driven [\`_generic-x402-bridge\`](../_generic-x402-bridge).
No bridge code to edit — everything is in \`.env\`.

## Go live

1. Put your upstream API key in \`.env\` → \`UPSTREAM_API_KEY=...\`
2. Set \`BRIDGE_MERCHANT_WALLET\` to your payout wallet (defaults to the AiFinPay treasury Safe).
3. Run:
   \`\`\`bash
   cd examples/_generic-x402-bridge && npm install
   node --env-file=../${slug}-x402-bridge/.env server.js
   \`\`\`
4. Put it behind nginx at \`https://bridge.aifinpay.io/${slug}\` and add the
   registry entry below to \`oracle-financial-hub-59/backend/services.json\`.
   Once the bridge answers \`GET /.well-known/x402.json\`, the provider pinger
   marks it \`live\` and it becomes auto-selectable via \`/api/registry/best\`.

## Registry entry (paste into services.json → "services")

\`\`\`json
${registrySnippet}
\`\`\`

- upstream: \`${upstreamUrl}\` (auth: \`${authStyle}\`)
- exposed path: \`POST ${routePath}\`
- price: $${priceUsd}/call (≈ ${priceWei} wei @ ${polUsd} POL/USD)
`;
fs.writeFileSync(path.join(bridgeDir, "README.md"), readme);

console.log(`✓ scaffolded ${slug}`);
console.log(`  ${path.relative(ROOT, path.join(bridgeDir, ".env"))}`);
console.log(`  ${path.relative(ROOT, path.join(bridgeDir, "README.md"))}`);
console.log(`\nRegistry entry (paste into services.json → "services"):\n`);
console.log(registrySnippet);
