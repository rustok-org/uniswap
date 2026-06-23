import { createRequire } from "node:module";

import type { CosignedV2DutchOrder } from "@uniswap/uniswapx-sdk";
import { ethers } from "ethers";

// The official UniswapX SDK ships a broken ESM build — its `dist/esm` entry uses
// directory imports that Node's native ESM loader rejects (ERR_UNSUPPORTED_DIR_IMPORT).
// Load the working CJS build via createRequire so this module runs under Node >= 22 ESM
// (and vitest). `import type` above keeps full typing without a runtime ESM import.
const require = createRequire(import.meta.url);
const { CosignedV2DutchOrder: dutchOrderV2 } =
  require("@uniswap/uniswapx-sdk") as {
    CosignedV2DutchOrder: {
      parse(
        encodedOrder: string,
        chainId: number,
        permit2?: string,
      ): CosignedV2DutchOrder;
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

/**
 * Render a UniswapX V2 Dutch order into the exact EIP-712 digest its swapper signs.
 *
 * All order / witness / domain encoding is delegated to the official SDK
 * (`CosignedV2DutchOrder.parse(...).permitData()`); this function only runs ethers'
 * standard EIP-712 hashing over the SDK's typed data. It never re-implements the
 * Permit2 witness type-string or the version-less domain — one wrong byte would be a
 * valid signature over the wrong order.
 *
 * @param encodedOrder ABI-encoded UniswapX V2 Dutch order (e.g. `quote.encodedOrder`).
 * @param chainId      Chain the order targets (Ethereum mainnet = 1).
 */
export function encodeCosignedV2DutchOrder(
  encodedOrder: string,
  chainId: number,
): OrderEip712Digest {
  const order = dutchOrderV2.parse(encodedOrder, chainId);
  const permit = order.permitData();

  // ethers derives the domain separately and rejects an explicit `EIP712Domain` entry
  // in `types`; permit2-sdk omits it. If a future SDK adds it, `from()` throws loudly.
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
