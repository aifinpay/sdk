import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AiFinPayAgent } from "../src/index.js";

// ── Discovery + routing (Gateway) tests ─────────────────────────────────────
//
// Exercises discover() / pickProvider() / capability()+webSearch() against a
// mocked gateway. Invariants:
//   - discover() hits /api/registry with q/category and returns providers[]
//   - pickProvider() hits /api/registry/best and unwraps `best`; 404 → throws
//   - webSearch() routes (best) → resolves the flat provider (/api/providers)
//     → POSTs the capability body to the bridge path (/search)

interface Captured { url: string; method: string; body: any; }

let originalFetch: typeof globalThis.fetch;
let captured: Captured[] = [];

const REGISTRY = [
  { slug: "exa", name: "exa", display_name: "Exa AI search", service_type: "search",
    category: "search", tagline: "Web search", price_usd: 0.0105, availability: "available",
    status: "live", latency_ms: 120, last_check: 1_700_000_000, modes: {} },
];

const BEST_SEARCH = {
  category: "search", q: null,
  best: { ...REGISTRY[0], score: 0.98, score_breakdown: { price: 1, latency: 1, liveness: 1, trust: 0.8 } },
  ranked: [{ ...REGISTRY[0], score: 0.98 }],
};

const FLAT_PROVIDERS = [
  { name: "exa", display_name: "Exa AI search", preferred_chain: "polygon",
    accepted_chains: ["polygon"], price_usd: 0.0105, mode: "per_call",
    bridge_url: "https://bridge.example/exa", merchant_wallet: "0xMerchant",
    service_type: "search", url: "https://exa.ai" },
];

function installMock(opts: { bestStatus?: number } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: any;
    if (init?.body) { try { body = JSON.parse(String(init.body)); } catch { body = String(init.body); } }
    captured.push({ url, method, body });

    const u = new URL(url);
    const path = u.pathname;

    if (path === "/api/registry") {
      return json({ count: REGISTRY.length, total: REGISTRY.length, providers: REGISTRY });
    }
    if (path === "/api/registry/best") {
      if (opts.bestStatus === 404) return json({ error: "no_provider" }, 404);
      return json(BEST_SEARCH);
    }
    if (path === "/api/providers") {
      return json({ providers: FLAT_PROVIDERS });
    }
    // Bridge capability endpoint — return a non-402 so call() passes it through
    // without an on-chain payment (we only assert routing here).
    if (path === "/exa/search") {
      return json({ results: ["ok"] }, 200);
    }
    return new Response("not mocked", { status: 404 });
  }) as typeof globalThis.fetch;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => { originalFetch = globalThis.fetch; captured = []; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe("AiFinPayAgent.discover", () => {
  it("queries /api/registry with category + q and returns providers", async () => {
    installMock();
    const agent = await AiFinPayAgent.new({ telemetry: false });
    const list = await agent.discover({ category: "search", q: "web" });

    const u = new URL(captured[0]!.url);
    expect(u.pathname).toBe("/api/registry");
    expect(u.searchParams.get("category")).toBe("search");
    expect(u.searchParams.get("q")).toBe("web");
    expect(list).toHaveLength(1);
    expect(list[0]!.slug).toBe("exa");
    expect(list[0]!.status).toBe("live");
  });

  it("applies a client-side limit", async () => {
    installMock();
    const agent = await AiFinPayAgent.new({ telemetry: false });
    const list = await agent.discover({ category: "search", limit: 0 });
    expect(list).toHaveLength(0);
  });
});

describe("AiFinPayAgent.pickProvider", () => {
  it("unwraps the best pick from /api/registry/best", async () => {
    installMock();
    const agent = await AiFinPayAgent.new({ telemetry: false });
    const best = await agent.pickProvider("search", { maxPriceUsd: 0.05 });

    const u = new URL(captured[0]!.url);
    expect(u.pathname).toBe("/api/registry/best");
    expect(u.searchParams.get("category")).toBe("search");
    expect(u.searchParams.get("max_price_usd")).toBe("0.05");
    expect(best.slug).toBe("exa");
    expect(best.score).toBe(0.98);
  });

  it("throws ProviderUnknownError when nothing matches (404)", async () => {
    installMock({ bestStatus: 404 });
    const agent = await AiFinPayAgent.new({ telemetry: false });
    await expect(agent.pickProvider("image")).rejects.toThrow(/No available provider for category "image"/);
  });
});

describe("AiFinPayAgent.webSearch", () => {
  it("routes via best → resolves flat provider → POSTs body to the bridge", async () => {
    installMock();
    const agent = await AiFinPayAgent.new({ telemetry: false });
    const resp = await agent.webSearch("hello world");

    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(200);

    const paths = captured.map((c) => new URL(c.url).pathname);
    expect(paths).toContain("/api/registry/best");
    expect(paths).toContain("/api/providers");
    expect(paths).toContain("/exa/search");

    const bridgeCall = captured.find((c) => new URL(c.url).pathname === "/exa/search")!;
    expect(bridgeCall.method).toBe("POST");
    expect(bridgeCall.body).toEqual({ query: "hello world" });
  });
});
