# Round-trip harness — live core+gateway sign path (PR-2 Slice 2b-1)

Proves the `GatewayHttpSigner` → gateway → core EIP-712 sign path end-to-end against a **real,
locally-running core+gateway** with a **throwaway TEST wallet (NO funds)**. This is the (C)
independent-oracle check: the signature is recover-verified against the **core wallet's** address
(not the signer's self-report). The Reviewer runs this at Gate-2 (Metric-Honesty).

It is **not** part of CI: `npm test` discovers the round-trip spec but **skips** it unless
`RUSTOK_ROUNDTRIP_URL` is set. Nothing here builds `../../../core` in CI.

> ⚠️ Throwaway only. The keyring password and gateway bearer below are local test secrets and
> the wallet holds **no funds** — never reuse them, and never point this at production.

## What it proves

`requestSwap(quote, intent, { signer: await GatewayHttpSigner.create(url, bearer) }, now)` with an
**injected fresh `now`** (the live clock would refuse a past-deadline order — we test the sign path,
not freshness) signs an order and the signature recover-verifies to the core wallet. Success
transitively confirms the whole wire contract: snake_case `{domain_separator, struct_hash}` body
(the real gateway 400s otherwise), the `0x`-less → `0x` response handling, digest agreement, and the
verified `r‖s‖v` / v=27/28 layout — all compose, with no v-normalization.

Core's onboarding **generates a random wallet** (no private-key import), so the test does **not** use
the committed `swapper=Hardhat#1` fixture; it **builds an order at runtime whose `swapper` is the live
core wallet address** (read from `GET /wallet/context`). That keeps the harness self-contained and the
swapper-bind satisfied by construction.

## Run

**Requires Docker** (Compose v2) and the ability to build the `../../../core` image. On a
podman-only host (e.g. Fedora) install a Compose provider first — `sudo dnf install podman-compose`
(or `docker-compose`) — and substitute `podman compose` for `docker compose` below; otherwise the
`docker compose` commands fail with "command not found".

From this directory (`uniswap/test/roundtrip/`):

```bash
# 1. Throwaway local secrets (NO funds, never near prod).
export RUSTOK_KEYRING_PASSWORD=roundtrip-throwaway-pw
export RUSTOK_MCP_API_KEY=roundtrip-throwaway-bearer

# 2. One-shot: create the test keystore in the volume (random wallet; prints a mnemonic — ignore,
#    it is throwaway). Must run BEFORE `up` — core won't serve without an unlocked wallet.
docker compose -f docker-compose.roundtrip.yml run --rm core create-wallet

# 3. Bring up core (unlocks the keystore) + gateway (127.0.0.1:3000).
#    `--wait` blocks until the gateway healthcheck reports a serving Core downstream.
docker compose -f docker-compose.roundtrip.yml up -d --wait

# 4. Run the round-trip from the package root (uniswap/).
cd ../..
RUSTOK_ROUNDTRIP_URL=http://127.0.0.1:3000 \
RUSTOK_MCP_API_KEY=roundtrip-throwaway-bearer \
  npx vitest run test/roundtrip

# 5. Tear down (— `-v` drops the wallet volume).
cd test/roundtrip
docker compose -f docker-compose.roundtrip.yml down -v
```

A green run prints one passing test: the live signature recovered to the core wallet address and the
orchestrator's reconstructed digest matched what core signed.
