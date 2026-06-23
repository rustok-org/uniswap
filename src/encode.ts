import { createRequire } from "node:module";

import type {
  CosignedV2DutchOrder,
  UnsignedV2DutchOrder,
} from "@uniswap/uniswapx-sdk";
import { ethers } from "ethers";

import type { OrderOutput, Quote } from "./types.js";

// The official UniswapX SDK ships a broken ESM build — its `dist/esm` entry uses
// directory imports that Node's native ESM loader rejects (ERR_UNSUPPORTED_DIR_IMPORT).
// Load the working CJS build via createRequire so this module runs under Node >= 22 ESM
// (and vitest). `import type` above keeps full typing without a runtime ESM import.
const require = createRequire(import.meta.url);
const sdk = require("@uniswap/uniswapx-sdk") as {
  CosignedV2DutchOrder: {
    parse(
      encodedOrder: string,
      chainId: number,
      permit2?: string,
    ): CosignedV2DutchOrder;
  };
  UnsignedV2DutchOrder: {
    parse(
      encodedOrder: string,
      chainId: number,
      permit2?: string,
    ): UnsignedV2DutchOrder;
  };
};

/** The EIP-712 hashes a UniswapX swapper signs for a Permit2 witness order. */
export interface OrderEip712Digest {
  /** keccak256 of the EIP-712 domain — the Permit2 `DOMAIN_SEPARATOR`. */
  readonly domainSeparator: string;
  /** hashStruct of the primary type (`PermitWitnessTransferFrom`). */
  readonly structHash: string;
  /** The signed digest: keccak256(0x1901 ‖ domainSeparator ‖ structHash). */
  readonly digest: string;
}

/** The SDK's EIP-712 typed data for a V2 order's Permit2 witness signature. */
type Permit2WitnessData = ReturnType<UnsignedV2DutchOrder["permitData"]>;

/**
 * Run ethers' standard EIP-712 hashing over the SDK-produced typed data. We never
 * re-implement the Permit2 witness type-string or the version-less domain — one wrong
 * byte would be a valid signature over the wrong order.
 *
 * ethers derives the domain separately and rejects an explicit `EIP712Domain` entry in
 * `types`; permit2-sdk omits it. If a future SDK adds it, `from()` throws loudly.
 */
function digestFromPermit(permit: Permit2WitnessData): OrderEip712Digest {
  const encoder = ethers.utils._TypedDataEncoder.from(permit.types);
  return {
    domainSeparator: ethers.utils._TypedDataEncoder.hashDomain(permit.domain),
    structHash: encoder.hashStruct(encoder.primaryType, permit.values),
    digest: ethers.utils._TypedDataEncoder.hash(
      permit.domain,
      permit.types,
      permit.values,
    ),
  };
}

/**
 * Render a **cosigned (post-fill)** UniswapX V2 Dutch order into the EIP-712 digest its
 * swapper signs. Encoding is delegated to the official SDK
 * (`CosignedV2DutchOrder.parse(...).permitData()`).
 *
 * @param encodedOrder ABI-encoded cosigned V2 Dutch order.
 * @param chainId      Chain the order targets (Ethereum mainnet = 1).
 */
export function encodeCosignedV2DutchOrder(
  encodedOrder: string,
  chainId: number,
): OrderEip712Digest {
  return digestFromPermit(
    sdk.CosignedV2DutchOrder.parse(encodedOrder, chainId).permitData(),
  );
}

/**
 * Render a **quote-time (pre-cosign)** UniswapX V2 Dutch order — the form a maker actually
 * signs, as returned by the Trading API `/quote` `encodedOrder` — into the EIP-712 digest.
 * Encoding is delegated to the official SDK
 * (`UnsignedV2DutchOrder.parse(...).permitData()`).
 *
 * @param encodedOrder ABI-encoded unsigned V2 Dutch order (`quote.encodedOrder`).
 * @param chainId      Chain the order targets (Ethereum mainnet = 1).
 */
export function encodeUnsignedV2DutchOrder(
  encodedOrder: string,
  chainId: number,
): OrderEip712Digest {
  return digestFromPermit(
    sdk.UnsignedV2DutchOrder.parse(encodedOrder, chainId).permitData(),
  );
}

/** A quote-time V2 order decoded into the fields the safety gates need + its digest. */
export interface DecodedV2Order {
  /** Hard order expiry (unix seconds) — used by the freshness gate. */
  readonly deadline: number;
  /** Address that signs and receives — the order's `swapper`. */
  readonly swapper: string;
  /** Per-output token / recipient / floor amount — used by the minOut gate. */
  readonly outputs: readonly OrderOutput[];
  /** The EIP-712 digest reconstructed from this order (what we sign). */
  readonly digest: OrderEip712Digest;
}

/**
 * Independently decode a quote-time `UnsignedV2DutchOrder` from its `encodedOrder` into the
 * gate-relevant fields plus its reconstructed digest. The orchestrator runs gates on THIS
 * (the order itself), never on the API's claimed `orderInfo` — reconstruct-before-sign.
 */
export function decodeUnsignedV2DutchOrder(
  encodedOrder: string,
  chainId: number,
): DecodedV2Order {
  const order = sdk.UnsignedV2DutchOrder.parse(encodedOrder, chainId);
  return {
    deadline: order.info.deadline,
    swapper: order.info.swapper,
    outputs: order.info.outputs.map((o) => ({
      token: o.token,
      recipient: o.recipient,
      endAmount: BigInt(o.endAmount.toString()),
    })),
    digest: digestFromPermit(order.permitData()),
  };
}

/**
 * Hash the EIP-712 typed data a `/quote` says to sign (its `permitData`) into the signed
 * digest. The orchestrator compares this to the digest reconstructed from `encodedOrder`;
 * a mismatch means the API's claim and the order disagree → refuse to sign.
 */
export function digestOfPermitData(permit: Quote["permitData"]): string {
  return ethers.utils._TypedDataEncoder.hash(
    permit.domain,
    permit.types,
    permit.values,
  );
}
