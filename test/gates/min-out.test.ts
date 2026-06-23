import { describe, expect, it } from "vitest";

import { checkMinOut } from "../../src/gates/min-out.js";
import type { Intent, OrderOutput } from "../../src/types.js";

const USER = "0xEC07125fa34c52f1cc370F6B96648a2BDa80f8ff";
const FEE = "0x000000000000000000000000000000000000dEaD";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

function intent(minOut: bigint, recipient: string = USER): Intent {
  return {
    recipient,
    minOut,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: 1n,
    chainId: 1,
  };
}
function out(recipient: string, endAmount: bigint): OrderOutput {
  return { token: USDC, recipient, endAmount };
}

describe("checkMinOut", () => {
  it("rejects when the user's floor is below minOut (test 3)", () => {
    expect(() => checkMinOut([out(USER, 1000n)], intent(2000n))).toThrow(
      /minOut/,
    );
  });

  it("rejects a non-positive minOut (test 3b)", () => {
    expect(() => checkMinOut([out(USER, 1000n)], intent(0n))).toThrow(
      /positive/,
    );
  });

  it("sums only the user's outputs, excluding fee outputs (test 6)", () => {
    const outputs = [out(USER, 1000n), out(FEE, 500n)];
    // passes against the user's floor (1000) ...
    expect(() => checkMinOut(outputs, intent(1000n))).not.toThrow();
    // ... and would fail at 1500, proving the fee output (500) is NOT counted.
    expect(() => checkMinOut(outputs, intent(1500n))).toThrow(/minOut/);
  });

  it("rejects when no output pays the intended recipient (test 7)", () => {
    expect(() => checkMinOut([out(FEE, 10_000n)], intent(1n))).toThrow(
      /no order output/,
    );
  });

  it("uses BigInt — sums uint256 amounts above 2^53 without overflow", () => {
    const big = 9_000_000_000_000_000_000n; // 9e18 > Number.MAX_SAFE_INTEGER
    expect(() => checkMinOut([out(USER, big)], intent(big))).not.toThrow();
    expect(() => checkMinOut([out(USER, big)], intent(big + 1n))).toThrow(
      /minOut/,
    );
  });
});
