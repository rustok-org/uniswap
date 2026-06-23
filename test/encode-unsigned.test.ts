import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { encodeUnsignedV2DutchOrder } from "../src/encode.js";

const require = createRequire(import.meta.url);

/**
 * Hermetic known-answer for a QUOTE-TIME (unsigned) V2 order — see
 * test/fixtures/unsigned-v2-quote.json for provenance. NOT signature-anchored: this is an
 * API-consistency check (our re-encode of `encodedOrder` == the digest the `/quote`
 * `permitData` implies), not an external anchor (spec: Anchor honesty).
 */
interface UnsignedV2Fixture {
  readonly chainId: number;
  readonly encodedOrder: string;
  /** ethers EIP-712 hash of the quote's permitData (the to-sign digest). */
  readonly apiDigest: string;
  /** Permit2 DOMAIN_SEPARATOR from the quote's permitData domain. */
  readonly apiDomainSeparator: string;
}

const fx = require("./fixtures/unsigned-v2-quote.json") as UnsignedV2Fixture;

describe("encodeUnsignedV2DutchOrder", () => {
  const { domainSeparator, digest } = encodeUnsignedV2DutchOrder(
    fx.encodedOrder,
    fx.chainId,
  );

  it("reproduces the quote's permitData digest (reconstruct-before-sign)", () => {
    expect(digest).toBe(fx.apiDigest);
  });

  it("derives the canonical Permit2 domain separator", () => {
    expect(domainSeparator).toBe(fx.apiDomainSeparator);
  });
});
