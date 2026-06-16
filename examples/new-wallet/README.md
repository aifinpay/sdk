## new-wallet

Tiny example that generates a fresh EVM (Polygon-compatible) keypair for
an autonomous AI agent. The private key is created locally with viem and
never crosses the network.

### Usage

```bash
cd examples/new-wallet
npm install
node new-wallet.mjs
```

Output:
```
address:     0x...
privateKey:  0x...
```

### One-shot version (no clone needed)

```bash
node -e "import('viem/accounts').then(({generatePrivateKey, privateKeyToAccount}) => {
  const pk = generatePrivateKey();
  console.log('address:', privateKeyToAccount(pk).address);
  console.log('privateKey:', pk);
});"
```

### Next steps

1. Save the `privateKey` somewhere safe (env var, password manager,
   hardware-backed store). Never commit, never share, never send.
2. Fund the address with ~0.5 POL on Polygon (≈ $0.05) — covers a few
   x402 calls plus gas.
3. Register the address at
   [dashboard.aifinpay.io/partners](https://dashboard.aifinpay.io/partners)
   so on-chain activity is attributed to your workspace.
4. Run your agent:

```ts
import { AiFinPayAgent } from "@aifinpay/agent";

const agent = new AiFinPayAgent({ privateKey: process.env.AGENT_PK });

const out = await agent.call({
  provider: "io-net",
  body: {
    model: "meta-llama/Llama-3.3-70B-Instruct",
    messages: [{ role: "user", content: "hi" }],
  },
});
```
