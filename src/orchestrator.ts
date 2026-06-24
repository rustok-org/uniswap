import { ethers } from "ethers";

import { decodeUnsignedV2DutchOrder, digestOfPermitData } from "./encode.js";
import { checkMinOut } from "./gates/min-out.js";
import type { Signer } from "./signer.js";
import type { Intent, Quote } from "./types.js";

export interface SwapDeps {
  readonly signer: Signer;
}

export interface SignedOrder {
  readonly digest: string;
  readonly signature: string;
}

/**
 * The orchestrator — the SOLE route to a signature (no bypass by construction). Given a
 * quote and the user's intent, it:
 *   1. independently reconstructs the order's digest from `encodedOrder`;
 *   2. **reconstruct-before-sign** — refuses unless that digest equals the digest the
 *      quote's `permitData` implies (the API's claim and the order must agree);
 *   3. runs the **recipient-aware minOut** gate on the decoded order;
 *   4. enforces **freshness** — refuses a stale order (`now >= deadline`);
 *   5. signs the digest through the single `Signer` seam;
 *   6. recover-verifies the signature against the signer's address.
 *
 * Any failure throws **before** the signer is reached (no signature on reject). `now` is
 * injected (unix seconds) for deterministic tests. NB: the production invariant
 * `recover == order.swapper` (sign only your own order) is verified in the live slice — here
 * the dev key ≠ the order's swapper, so Slice 1 verifies only the seam.
 */
export async function requestSwap(
  quote: Quote,
  intent: Intent,
  deps: SwapDeps,
  now: number,
): Promise<SignedOrder> {
  const decoded = decodeUnsignedV2DutchOrder(
    quote.encodedOrder,
    intent.chainId,
  );
  const digest = decoded.digest.digest;

  if (digest !== digestOfPermitData(quote.permitData)) {
    throw new Error(
      "reconstruct-before-sign: encodedOrder digest != quote permitData digest",
    );
  }

  checkMinOut(decoded.outputs, intent);

  if (now >= decoded.deadline) {
    throw new Error(
      `freshness: now ${now} >= order deadline ${decoded.deadline}`,
    );
  }

  const signature = await deps.signer.signTypedData(decoded.digest);

  const recovered = ethers.utils.getAddress(
    ethers.utils.recoverAddress(digest, signature),
  );
  if (recovered !== ethers.utils.getAddress(deps.signer.address)) {
    throw new Error("recover-verify: signature does not recover to the signer");
  }

  return { digest, signature };
}
