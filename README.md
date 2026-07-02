# rustok-org/uniswap

> 🅿️ **PARKED (2026-07-02).** Арка на паузе (`@e69bc5b`); оживает серверно на Этапе 4 (swap = Agent-proposed). Живой статус — `core/.claude/PLAN-OF-RECORD.md`.

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
