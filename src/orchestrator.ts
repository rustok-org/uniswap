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
 *   3. **swapper-bind** — refuses unless the order's `swapper` is the signing wallet
 *      (sign only your *own* order);
 *   4. runs the **recipient-aware minOut** gate on the decoded order;
 *   5. enforces **freshness** — refuses a stale order (`now >= deadline`);
 *   6. signs the order's EIP-712 hashes through the single `Signer` seam;
 *   7. recover-verifies the signature against the signer's address.
 *
 * Any failure throws **before** the signer is reached (no signature on reject). `now` is
 * injected (unix seconds) so tests are deterministic; the live entry point
 * {@link requestSwapLive} is the only caller that reads the wall clock. The pre-sign
 * swapper-bind (3) and the post-sign recover-verify (7) are transitive:
 * `recover == signer.address == order.swapper` ⇒ you can only sign your own order.
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

  if (
    ethers.utils.getAddress(decoded.swapper) !==
    ethers.utils.getAddress(deps.signer.address)
  ) {
    throw new Error(
      "swapper-bind: order swapper is not the signing wallet (refuse to sign another's order)",
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

/**
 * Live entry point — the **sole** place the wall clock is read. Injects a trusted `now`
 * (`Math.floor(Date.now() / 1000)`) into {@link requestSwap}; the clock is never sourced from
 * the agent or the quote (an attacker-supplied `now` would defeat refuse-when-stale). All
 * other logic is shared with the injectable `requestSwap`, which keeps `now` a parameter so
 * tests stay deterministic.
 */
export async function requestSwapLive(
  quote: Quote,
  intent: Intent,
  deps: SwapDeps,
): Promise<SignedOrder> {
  return requestSwap(quote, intent, deps, Math.floor(Date.now() / 1000));
}
