# Changelog

All notable changes to the AiFinPay SDK packages are documented here.
Versioning follows [Semantic Versioning](https://semver.org/). From
`1.0.0` onward the public API is stable and changes follow semver.

## 1.0.1 — 2026-06-22

Discovery + Gateway routing on `@aifinpay/agent` (Node). Additive, no
breaking changes.

### Added
- **`agent.discover({category, q, limit})`** — browse the provider
  catalog (`/api/registry`) filtered by category / free text; each entry
  carries live `status` + `latency_ms`.
- **`agent.pickProvider(category, {q, maxPriceUsd})`** — server-side
  automatic provider selection via `/api/registry/best` (ranked by price,
  latency, liveness, on-chain trust).
- **Capability convenience methods** — `agent.webSearch()`,
  `agent.image()`, `agent.voice()`, `agent.infer()` and the generic
  `agent.capability(category, body, opts)`: pick the best provider, pay,
  and return the upstream response in one call.
- Exported types `DiscoveredProvider`, `DiscoverOptions`,
  `CapabilityOptions`.
- `call()` path map extended for `image` (`/images/generations`) and
  `speech` (`/audio/speech`) service types.
- **`scripts/new-provider.mjs`** + **`examples/_generic-x402-bridge`** —
  config-only bridge to onboard a new provider without editing code.

### Note
- `agent.search()` is unchanged — it still searches the public **agent**
  network directory. Web search via the marketplace is `agent.webSearch()`
  (named to avoid colliding with the published `search()`).

## 1.0.0 — 2026-06-16

First stable release. The three packages graduate from alpha to a
semver-stable `1.0.0` on PyPI and npm under the default (`latest`) tag.

### Packages
- `aifinpay-agent` (Python) — `1.0.0`
- `@aifinpay/agent` (Node / TypeScript) — `1.0.0`
- `@aifinpay/mcp` (MCP server) — `1.0.0`

### Stable
- **Unified `AiFinPayAgent` surface** — chain-opaque `call({provider})`
  plus `openSession` / `balance` / `verify` / `deposit`. The legacy
  chain-aware `Agent` class stays exported and continues to work.
- **Non-custodial settlement** — the agent's private key never leaves
  the process; payment is a single atomic on-chain transaction.
- **Multi-chain** — Polygon + Solana mainnet, with the SDK selecting the
  funding path so callers don't hand-pick a chain.
- **Fee-on-top split** — `quote_split` / `pay_with_split` surface the
  merchant / protocol / referral breakdown before paying.
- **MCP server** — `@aifinpay/mcp` exposes the agent payment tools to
  MCP runtimes (Claude Code, Cursor, etc.).
- **Cross-chain helpers** — `bridgeQuote` / `bridgeExecute` /
  `bridgeWaitForArrival` over third-party bridges (funds never touch
  AiFinPay infra).

### Changed
- Install commands no longer require a prerelease tag:
  `pip install aifinpay-agent` and `npm install @aifinpay/agent`.
- All documentation, example endpoints, and contact email moved to the
  canonical `aifinpay.io` domain. The legacy `aifinpay.company` host is
  fully retired (DNS removed).

### Notes
- Semver guarantees apply from `1.0.0`: no breaking changes without a
  major bump; deprecations ship with a minor and a migration note.
