import type { TypedDataDomain, TypedDataField } from "ethers";

/** The user's swap intent — the orchestrator checks the built order against this. */
export interface Intent {
  /** The address that MUST receive the output tokens (the user). */
  readonly recipient: string;
  /** Minimum output the user accepts, at the auction floor. Required, `> 0`. */
  readonly minOut: bigint;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: bigint;
  readonly chainId: number;
}

/** A single order output the user could receive (decoded from the order). */
export interface OrderOutput {
  readonly token: string;
  readonly recipient: string;
  /** Auction-floor amount (uint256) — `bigint` to avoid JS number overflow. */
  readonly endAmount: bigint;
}

/** The Trading API `/quote` subset the orchestrator consumes. */
export interface Quote {
  /** ABI-encoded **unsigned** V2 Dutch order (`quote.encodedOrder`). */
  readonly encodedOrder: string;
  /** The EIP-712 typed data the API says to sign. */
  readonly permitData: {
    readonly domain: TypedDataDomain;
    readonly types: Record<string, TypedDataField[]>;
    readonly values: Record<string, unknown>;
  };
}
