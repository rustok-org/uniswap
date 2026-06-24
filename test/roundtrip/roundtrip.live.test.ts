import { createRequire } from "node:module";

import { BigNumber, ethers } from "ethers";
import { describe, expect, it } from "vitest";

import { encodeUnsignedV2DutchOrder } from "../../src/encode.js";
import { GatewayHttpSigner } from "../../src/gateway-signer.js";
import { requestSwap } from "../../src/orchestrator.js";
import type { Intent, Quote } from "../../src/types.js";

// Env-gated: skipped (no network) unless a live gateway URL + bearer are provided. See README.md
// for the docker-compose harness. NOT run in CI — the round-trip is the Reviewer's Gate-2 check.
const URL = process.env.RUSTOK_ROUNDTRIP_URL;
const BEARER = process.env.RUSTOK_MCP_API_KEY;

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const COSIGNER = "0x4449Cd34d1eb1FEDCF02A1Be3834FfDe8E6A6180";

/** The slice of the SDK's `V2DutchOrderBuilder` this harness uses (CJS interop — minimal typing). */
interface V2Builder {
  deadline(t: number): V2Builder;
  swapper(a: string): V2Builder;
  nonce(n: BigNumber): V2Builder;
  decayStartTime(t: number): V2Builder;
  decayEndTime(t: number): V2Builder;
  input(i: {
    token: string;
    startAmount: BigNumber;
    endAmount: BigNumber;
  }): V2Builder;
  output(o: {
    token: string;
    startAmount: BigNumber;
    endAmount: BigNumber;
    recipient: string;
  }): V2Builder;
  cosigner(a: string): V2Builder;
  buildPartial(): {
    serialize(): string;
    permitData(): Quote["permitData"];
  };
}
const require = createRequire(import.meta.url);
const sdk = require("@uniswap/uniswapx-sdk") as {
  V2DutchOrderBuilder: new (chainId: number) => V2Builder;
};

/**
 * Build a quote-time UnsignedV2DutchOrder whose `swapper` is the live core wallet — core's
 * onboarding generates a random wallet (no key import), so we adapt the order to whatever address
 * `/wallet/context` returns. This keeps the swapper-bind satisfied by construction.
 */
function buildOrderFor(address: string): {
  quote: Quote;
  intent: Intent;
  deadline: number;
  apiDigest: string;
} {
  const deadline = 1893456000; // 2030 — the builder rejects past deadlines; `now` is injected fresh
  const order = new sdk.V2DutchOrderBuilder(1)
    .deadline(deadline)
    .swapper(address)
    .nonce(BigNumber.from(1))
    .decayStartTime(deadline - 100)
    .decayEndTime(deadline - 50)
    .input({
      token: WETH,
      startAmount: BigNumber.from("5000000000000000000"),
      endAmount: BigNumber.from("5000000000000000000"),
    })
    .output({
      token: USDC,
      startAmount: BigNumber.from("8447610412"),
      endAmount: BigNumber.from("8405372359"),
      recipient: address,
    })
    .cosigner(COSIGNER)
    .buildPartial();

  const encodedOrder = order.serialize();
  const permit = order.permitData();
  const quote: Quote = {
    encodedOrder,
    permitData: {
      domain: permit.domain,
      types: permit.types,
      values: permit.values,
    },
  };
  const intent: Intent = {
    recipient: address,
    minOut: 1n,
    tokenIn: WETH,
    tokenOut: USDC,
    amountIn: 5_000_000_000_000_000_000n,
    chainId: 1,
  };
  const apiDigest = encodeUnsignedV2DutchOrder(encodedOrder, 1).digest;
  return { quote, intent, deadline, apiDigest };
}

describe.skipIf(!URL || !BEARER)("round-trip (live core + gateway)", () => {
  it("signs a swapper-matched order through the live gateway; recovers to the core wallet", async () => {
    const signer = await GatewayHttpSigner.create(
      URL as string,
      BEARER as string,
    );
    const { quote, intent, deadline, apiDigest } = buildOrderFor(
      signer.address,
    );

    // Injected fresh `now` — `requestSwapLive`'s real clock would refuse this static order on
    // freshness; here we exercise the live sign path, which freshness must not block.
    const result = await requestSwap(quote, intent, { signer }, deadline - 60);

    expect(result.digest).toBe(apiDigest);
    expect(
      ethers.utils.getAddress(
        ethers.utils.recoverAddress(result.digest, result.signature),
      ),
    ).toBe(ethers.utils.getAddress(signer.address));
  });
});
