# AGENTS.md — rustok-org/uniswap

> The **glue layer** of the Uniswap × Rustok integration: encode UniswapX orders,
> run deterministic safety gates, hand the EIP-712 digest to the Rustok **core**
> for signing. **Holds no keys.** Core stays proprietary; this repo is MIT-0.

---

## Stack

- **Language:** TypeScript (strict), ESM.
- **Runtime:** Node ≥ 22 (current LTS).
- **Package manager:** npm.
- **Test runner:** vitest. **Format:** prettier. **Types:** `tsc --noEmit` (strict).
- **Order encoding:** the official `@uniswap/uniswapx-sdk` + `@uniswap/permit2-sdk`,
  consumed as **dependencies**. The Permit2 witness / version-less domain encoding is
  security-critical and is **never re-implemented or copied** here (clean-room).

---

## Key Rules

- **Never hand-roll order/witness/domain encoding.** Use the official SDK. One wrong
  byte = a valid signature over the _wrong_ order.
- **Test anchors must be EXTERNAL known-answers**, not the SDK's own output (and not
  ethers-over-SDK-output — that is circular). Anchor against the canonical Permit2
  `DOMAIN_SEPARATOR` and a Permit2 **signed digest** (`keccak256(0x1901 ‖ domain ‖
hashStruct(PermitWitnessTransferFrom))`), **not** the reactor `order.hash()`.
- **chainId-consistent fixtures:** order, domain separator and digest all for one chainId.
- **No secrets in code or logs.** Keys live only in the Rust core.
- **Pin exact SDK API names** from the installed package types, not from memory.

---

## CI Gates (all must pass before merge)

```bash
npm run build          # tsc --noEmit (strict)
npm test               # vitest run
npm run format         # prettier --check .
npm run license:check  # license-checker against the SPDX allowlist (mirror of cargo-deny)
```

**License allowlist** (permissive only — copyleft is rejected, mirroring core's
`cargo deny`): MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, CC0-1.0,
0BSD, Unlicense. A transitive dependency outside the list fails CI.

---

## Git Workflow

- **No direct push to `main`** (except the unavoidable genesis commit). All changes
  go through a branch + PR + CI + review.
- Conventional commits (`feat:`/`fix:`/`refactor:`/`test:`/`docs:`/`chore:`).
- Authorship is `Temrjan <omadgo@protonmail.com>`, **no AI attribution** anywhere.

---

## Trust Boundary (why this lives outside core)

The planning/encoding agent touches market data and runs with the Rustok `read_wallet`
capability only. This glue computes `(domainSeparator, structHash)` and asks the core
to sign over gRPC; **the private key and the signing act never leave the Rust core**.
Deterministic gates (slippage, destination-token safety, price cross-check, bounded
approval) live here and gate _what_ gets sent to the signer — they are the load-bearing
safety piece of the combined system (core `txguard` flags, it does not block).
