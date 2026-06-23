import { createRequire } from "node:module";

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";

import { encodeCosignedV2DutchOrder } from "../src/encode.js";

const require = createRequire(import.meta.url);

/** Hermetic external known-answer — see test/fixtures/dutch-v2-order.json for provenance. */
interface DutchV2Fixture {
  readonly chainId: number;
  readonly encodedOrder: string;
  readonly signature: string;
  /** Swapper from the on-chain Fill event — independent of the encoding under test. */
  readonly swapper: string;
  /** Live Permit2 DOMAIN_SEPARATOR() read on Ethereum mainnet. */
  readonly permit2DomainSeparator: string;
}

const fx = require("./fixtures/dutch-v2-order.json") as DutchV2Fixture;

describe("encodeCosignedV2DutchOrder", () => {
  const { domainSeparator, structHash, digest } = encodeCosignedV2DutchOrder(
    fx.encodedOrder,
    fx.chainId,
  );

  it("uses a single chainId (Ethereum mainnet) for every fixture value", () => {
    expect(fx.chainId).toBe(1);
  });

  // External anchor #1 (domain): byte-equal to the live on-chain DOMAIN_SEPARATOR().
  // Catches a wrong domain — e.g. a stray `version` field in the Permit2 domain.
  it("derives the canonical Permit2 domain separator", () => {
    expect(domainSeparator).toBe(fx.permit2DomainSeparator);
  });

  // External anchor #2 (LOAD-BEARING): a real swapper signature recovers to the
  // independently-sourced (Fill-event) swapper under our digest. A wrong domain OR a
  // wrong witness type-string ⇒ recovery yields a different address ⇒ this fails.
  // Not circular: the signature and swapper come from outside the SDK; ecrecover only
  // matches when our digest equals the exact message the swapper really signed.
  it("produces a digest a real swapper signature recovers to", () => {
    const recovered = ethers.utils.recoverAddress(
      digest,
      ethers.utils.splitSignature(fx.signature),
    );
    expect(ethers.utils.getAddress(recovered)).toBe(
      ethers.utils.getAddress(fx.swapper),
    );
  });

  // Internal consistency (non-load-bearing): digest = keccak256(0x1901 ‖ domSep ‖ structHash).
  it("composes the digest from the domain separator and struct hash", () => {
    const composed = ethers.utils.keccak256(
      ethers.utils.concat(["0x1901", domainSeparator, structHash]),
    );
    expect(digest).toBe(composed);
  });
});
