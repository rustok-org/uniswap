import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";

import type { OrderEip712Digest } from "../src/encode.js";
import { requestSwap } from "../src/orchestrator.js";
import { DevKeyringSigner, type Signer } from "../src/signer.js";
import type { Intent, Quote } from "../src/types.js";

const require = createRequire(import.meta.url);

interface Fixture {
  readonly chainId: number;
  readonly encodedOrder: string;
  readonly swapper: string;
  readonly deadline: number;
  readonly apiDigest: string;
  readonly permitData: Quote["permitData"];
}
const fx = require("./fixtures/unsigned-v2-quote.json") as Fixture;

// Deterministic dev key for the hermetic harness — Hardhat test key #1, NOT a real wallet.
const DEV_PK =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const quote: Quote = {
  encodedOrder: fx.encodedOrder,
  permitData: fx.permitData,
};
const intent: Intent = {
  recipient: fx.swapper,
  minOut: 1n, // <= the order's floor
  tokenIn: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  tokenOut: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  amountIn: 5_000_000_000_000_000_000n,
  chainId: 1,
};
const FRESH = fx.deadline - 60;
const STALE = fx.deadline + 60;

/** Counts how many times the sole sign-route is invoked. */
class CountingSigner implements Signer {
  count = 0;
  constructor(private readonly inner: Signer) {}
  get address(): string {
    return this.inner.address;
  }
  async signTypedData(eip712: OrderEip712Digest): Promise<string> {
    this.count += 1;
    return this.inner.signTypedData(eip712);
  }
}

function tamperedQuote(): Quote {
  const permitData = JSON.parse(
    JSON.stringify(fx.permitData),
  ) as Quote["permitData"];
  // semantic mismatch: the API claims a different chain than the encoded order encodes.
  (permitData.domain as { chainId: number }).chainId = 999;
  return { encodedOrder: fx.encodedOrder, permitData };
}

describe("requestSwap (hermetic E2E)", () => {
  it("happy path: verifies, gates, signs, and recovers to the signer (test 1)", async () => {
    const signer = new DevKeyringSigner(DEV_PK);
    const result = await requestSwap(quote, intent, { signer }, FRESH);
    expect(result.digest).toBe(fx.apiDigest);
    expect(
      ethers.utils.getAddress(
        ethers.utils.recoverAddress(result.digest, result.signature),
      ),
    ).toBe(ethers.utils.getAddress(signer.address));
  });

  it("refuses a stale order (test 2)", async () => {
    const signer = new DevKeyringSigner(DEV_PK);
    await expect(requestSwap(quote, intent, { signer }, STALE)).rejects.toThrow(
      /freshness/,
    );
  });

  it("refuses when the quote's permitData disagrees with the order (test 4)", async () => {
    const signer = new DevKeyringSigner(DEV_PK);
    await expect(
      requestSwap(tamperedQuote(), intent, { signer }, FRESH),
    ).rejects.toThrow(/reconstruct-before-sign/);
  });

  describe("no-bypass (test 5)", () => {
    it("invokes the sign route exactly once on success, zero on every reject", async () => {
      const happy = new CountingSigner(new DevKeyringSigner(DEV_PK));
      await requestSwap(quote, intent, { signer: happy }, FRESH);
      expect(happy.count).toBe(1);

      const stale = new CountingSigner(new DevKeyringSigner(DEV_PK));
      await expect(
        requestSwap(quote, intent, { signer: stale }, STALE),
      ).rejects.toThrow();
      expect(stale.count).toBe(0);

      const tampered = new CountingSigner(new DevKeyringSigner(DEV_PK));
      await expect(
        requestSwap(tamperedQuote(), intent, { signer: tampered }, FRESH),
      ).rejects.toThrow();
      expect(tampered.count).toBe(0);

      const badMinOut = new CountingSigner(new DevKeyringSigner(DEV_PK));
      const tooHigh: Intent = { ...intent, minOut: 10n ** 30n };
      await expect(
        requestSwap(quote, tooHigh, { signer: badMinOut }, FRESH),
      ).rejects.toThrow();
      expect(badMinOut.count).toBe(0);
    });

    it("has exactly one sign-route caller outside the signer impl (structural)", () => {
      const root = new URL("../src", import.meta.url).pathname;
      const files = (function walk(dir: string): string[] {
        return readdirSync(dir).flatMap((name) => {
          const p = `${dir}/${name}`;
          return statSync(p).isDirectory()
            ? walk(p)
            : p.endsWith(".ts")
              ? [p]
              : [];
        });
      })(root);
      // signer.ts wraps the crypto primitive; gateway-signer.ts (live impl) forwards via fetch —
      // neither contains a `.signTypedData(` call-site. No OTHER src file may reach signing.
      const callers = files
        .filter((f) => !f.endsWith("/signer.ts"))
        .filter((f) => /\.signTypedData\(/.test(readFileSync(f, "utf8")))
        .map((f) => f.split("/").pop());
      expect(callers).toEqual(["orchestrator.ts"]);
    });
  });
});
