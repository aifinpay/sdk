# VHS tape — autonomous AI commerce on Polygon (AiFinPay × Exa).
#
# Renders a screen capture of the full x402 paid-proxy flow: agent calls
# bridge → 402 challenge → on-chain payMatic on Polygon → bridge verifies
# receipt → forwards to api.exa.ai → returns real search results.
#
# Prerequisites:
#   1. Install VHS:           brew install vhs
#   2. Bridge running:        cd .. && EXA_API_KEY=... \
#                               BRIDGE_MERCHANT_WALLET=0xD31d82… \
#                               PORT=3001 node server.js
#   3. Agent funded with ~0.01 MATIC on Polygon mainnet.
#
# Render:
#   AGENT_PRIVATE_KEY=0x... vhs demo.tape
# Output: demo.mp4 + demo.gif in the current directory.

Output demo.mp4
Output demo.gif

Set Shell zsh
Set FontSize 14
Set Width 1280
Set Height 720
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 25ms
Set PlaybackSpeed 1.0

# ── Title ──────────────────────────────────────────────────────────────────
Type "# AiFinPay × Polygon — autonomous AI commerce"
Enter
Sleep 1s

Type "# agent pays $0.005 in MATIC → proxy verifies on-chain → Exa returns results"
Enter
Sleep 1500ms

Type "clear"
Enter
Sleep 500ms

# ── Show agent identity + balance ──────────────────────────────────────────
Type 'echo "agent: 0xe1aE480678BF2D706666B3EbEaE4193180A9B6aF"'
Enter
Sleep 800ms

# ── Run the demo client ────────────────────────────────────────────────────
Type "node ../test-client.js 'autonomous AI commerce on Polygon'"
Enter

# Heuristic waits — adjust to your RPC speed.
# Initial 402 challenge typically returns in <1s; on-chain confirmation 4-10s.
Sleep 35s

# Hold the result on screen so viewers can read.
Sleep 5s
