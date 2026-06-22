# rustok-org/uniswap

> Reference integration: **Uniswap × Rustok** — the self-custody signing/gates glue layer for
> agent-driven Uniswap execution.

Uniswap plans and builds the order; [Rustok](https://github.com/rustok-org) — a self-custody
Ethereum agent wallet — risk-checks and signs it under human approval, with all key material
isolated in a Rust core. This repo is the glue: it encodes UniswapX orders, runs the deterministic
safety gates, and hands the EIP-712 digest to the Rustok core for signing. Keys never leave the core.

> **Status:** early scaffold. First deliverable — the UniswapX swap path (EIP-712 order signing).

## Stack

TypeScript. Order encoding uses the official `@uniswap/uniswapx-sdk` + `@uniswap/permit2-sdk`,
consumed as dependencies — the Permit2 witness / domain encoding is security-critical and is **not**
re-implemented here.

## License

MIT-0 (see [LICENSE](LICENSE)). The Rustok wallet **core** stays proprietary; this glue layer is open.
