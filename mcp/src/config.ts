/** Runtime configuration loaded from env. */
export interface McpConfig {
  /** Base58 secret to load the agent identity. If absent, a fresh keypair is
   *  generated AND printed to stderr at startup with a "save this!" warning. */
  agentSecretB58?: string;

  /** Custom AiFinPay backend URL. Defaults to production. */
  baseUrl?: string;

  /** Request timeout in ms. */
  timeoutMs?: number;

  /** Hard cap on a single payment to prevent runaway agents. */
  maxAmountUsd?: number;

  /** Optional log destination (defaults to stderr). */
  logFn?: (level: "info" | "warn" | "error", msg: string) => void;
}

export function loadConfigFromEnv(): McpConfig {
  return {
    agentSecretB58: process.env.AIFINPAY_AGENT_SECRET || undefined,
    baseUrl: process.env.AIFINPAY_BASE_URL || undefined,
    timeoutMs: process.env.AIFINPAY_TIMEOUT_MS
      ? Number(process.env.AIFINPAY_TIMEOUT_MS)
      : undefined,
    maxAmountUsd: process.env.AIFINPAY_MAX_USD
      ? Number(process.env.AIFINPAY_MAX_USD)
      : undefined,
  };
}
