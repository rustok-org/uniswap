import { ethers } from "ethers";

import type { Intent, OrderOutput } from "../types.js";

/**
 * Recipient-aware minOut gate. Sums the auction-floor `endAmount` (as `bigint` — amounts
 * are uint256, JS `number` overflows above 2^53) over **only the outputs paying
 * `intent.recipient`**, and requires the user's guaranteed receipt to meet `intent.minOut`.
 *
 * Fail-closed: rejects if `minOut` is non-positive, or if **no output pays the user** (an
 * order paying nothing/another address is a red flag). Fee outputs (`portionBips`) to other
 * recipients are excluded — a blind `outputs[0]`/sum-all would under-count and leak.
 *
 * Throws on failure; the orchestrator never reaches the signer when it throws.
 */
export function checkMinOut(
  outputs: readonly OrderOutput[],
  intent: Intent,
): void {
  if (intent.minOut <= 0n) {
    throw new Error("minOut gate: intent.minOut must be positive");
  }
  const recipient = ethers.utils.getAddress(intent.recipient);
  const userOutputs = outputs.filter(
    (o) => ethers.utils.getAddress(o.recipient) === recipient,
  );
  if (userOutputs.length === 0) {
    throw new Error("minOut gate: no order output pays the intended recipient");
  }
  const floor = userOutputs.reduce((acc, o) => acc + o.endAmount, 0n);
  if (floor < intent.minOut) {
    throw new Error(
      `minOut gate: user floor ${floor} < minOut ${intent.minOut}`,
    );
  }
}
