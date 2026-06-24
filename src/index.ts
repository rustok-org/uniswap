/**
 * rustok-org/uniswap — the Uniswap × Rustok glue layer.
 *
 * Public surface: the orchestrator (the sole route to a signature), its safety types, and the
 * two `Signer` implementations — `DevKeyringSigner` (hermetic tests) and `GatewayHttpSigner`
 * (live, signs through the Rust gateway).
 */
export const NAME = "@rustok-org/uniswap";

export { requestSwap, requestSwapLive } from "./orchestrator.js";
export type { SwapDeps, SignedOrder } from "./orchestrator.js";
export { DevKeyringSigner } from "./signer.js";
export type { Signer } from "./signer.js";
export { GatewayHttpSigner } from "./gateway-signer.js";
export type { Intent, Quote, OrderOutput } from "./types.js";
export type { OrderEip712Digest, DecodedV2Order } from "./encode.js";
