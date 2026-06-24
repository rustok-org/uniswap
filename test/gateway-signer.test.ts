import { ethers } from "ethers";
import { describe, expect, it } from "vitest";

import type { OrderEip712Digest } from "../src/encode.js";
import { GatewayHttpSigner } from "../src/gateway-signer.js";

const BASE = "http://gateway.test";
const BEARER = "test-bearer-key-2";

// Hardhat test key #0 — public, NO funds. Used only to mint a real signature for the
// recover-sanity check; the live signer holds no key.
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KEY = new ethers.utils.SigningKey(PK);
const ADDRESS = ethers.utils.computeAddress(KEY.publicKey);

function eip712(): OrderEip712Digest {
  const domainSeparator = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("domain-separator"),
  );
  const structHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes("struct-hash"),
  );
  const digest = ethers.utils.keccak256(
    ethers.utils.concat(["0x1901", domainSeparator, structHash]),
  );
  return { domainSeparator, structHash, digest };
}

/** The gateway's contract: r||s||v hex WITHOUT the 0x prefix. */
function noPrefixSignature(e: OrderEip712Digest): string {
  return ethers.utils.joinSignature(KEY.signDigest(e.digest)).slice(2);
}

interface Call {
  url: string;
  init: RequestInit;
}

function mockGateway(opts: {
  address?: unknown;
  signature?: unknown;
  contextStatus?: number;
  signStatus?: number;
}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/api/v1/wallet/context")) {
      const status = opts.contextStatus ?? 200;
      const payload =
        status === 200 ? JSON.stringify({ address: opts.address }) : "";
      return new Response(payload, { status });
    }
    if (url.endsWith("/api/v1/wallet/sign_typed_data")) {
      const status = opts.signStatus ?? 200;
      const payload =
        status === 200 ? JSON.stringify({ signature: opts.signature }) : "";
      return new Response(payload, { status });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string> | undefined)?.[name];
}

describe("GatewayHttpSigner.create", () => {
  it("GETs /wallet/context with Bearer and sets the wallet address", async () => {
    const gw = mockGateway({ address: ADDRESS });
    const signer = await GatewayHttpSigner.create(BASE, BEARER, gw.fetch);

    expect(signer.address).toBe(ADDRESS);
    const ctx = gw.calls.find((c) => c.url.endsWith("/wallet/context"));
    expect(ctx?.url).toBe(`${BASE}/api/v1/wallet/context`);
    expect(ctx?.init.method).toBe("GET");
    expect(headerOf(ctx!.init, "authorization")).toBe(`Bearer ${BEARER}`);
  });

  it("throws on a non-address from /wallet/context (fail-closed)", async () => {
    const gw = mockGateway({ address: "definitely-not-an-address" });
    await expect(
      GatewayHttpSigner.create(BASE, BEARER, gw.fetch),
    ).rejects.toThrow();
  });

  it("throws when /wallet/context omits the address", async () => {
    const gw = mockGateway({ address: undefined });
    await expect(
      GatewayHttpSigner.create(BASE, BEARER, gw.fetch),
    ).rejects.toThrow(/address/);
  });

  it("throws on a 401 from /wallet/context", async () => {
    const gw = mockGateway({ contextStatus: 401 });
    await expect(
      GatewayHttpSigner.create(BASE, BEARER, gw.fetch),
    ).rejects.toThrow(/401/);
  });
});

describe("GatewayHttpSigner.signTypedData", () => {
  it("POSTs snake_case {domain_separator, struct_hash}, both 0x-prefixed", async () => {
    const e = eip712();
    const gw = mockGateway({
      address: ADDRESS,
      signature: noPrefixSignature(e),
    });
    const signer = await GatewayHttpSigner.create(BASE, BEARER, gw.fetch);

    await signer.signTypedData(e);

    const call = gw.calls.find((c) => c.url.endsWith("/sign_typed_data"));
    expect(call?.url).toBe(`${BASE}/api/v1/wallet/sign_typed_data`);
    expect(call?.init.method).toBe("POST");
    expect(headerOf(call!.init, "authorization")).toBe(`Bearer ${BEARER}`);
    const body = JSON.parse(call!.init.body as string) as Record<
      string,
      string
    >;
    expect(body).toEqual({
      domain_separator: e.domainSeparator,
      struct_hash: e.structHash,
    });
    expect(body.domain_separator).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.struct_hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("prepends 0x to the gateway's 0x-less signature; it recovers to the wallet", async () => {
    const e = eip712();
    const gw = mockGateway({
      address: ADDRESS,
      signature: noPrefixSignature(e),
    });
    const signer = await GatewayHttpSigner.create(BASE, BEARER, gw.fetch);

    const sig = await signer.signTypedData(e);

    expect(sig.startsWith("0x")).toBe(true);
    expect(sig).toHaveLength(132); // 0x + 65 bytes
    expect(
      ethers.utils.getAddress(ethers.utils.recoverAddress(e.digest, sig)),
    ).toBe(ADDRESS);
  });

  describe("fail-closed", () => {
    it("throws on a non-2xx from /sign_typed_data", async () => {
      const e = eip712();
      const gw = mockGateway({ address: ADDRESS, signStatus: 503 });
      const signer = await GatewayHttpSigner.create(BASE, BEARER, gw.fetch);
      await expect(signer.signTypedData(e)).rejects.toThrow(/503/);
    });

    it("throws when the signature is missing", async () => {
      const e = eip712();
      const gw = mockGateway({ address: ADDRESS, signature: undefined });
      const signer = await GatewayHttpSigner.create(BASE, BEARER, gw.fetch);
      await expect(signer.signTypedData(e)).rejects.toThrow(/signature/);
    });

    it("throws on a short / non-hex signature", async () => {
      const e = eip712();
      const gw = mockGateway({ address: ADDRESS, signature: "abcd" });
      const signer = await GatewayHttpSigner.create(BASE, BEARER, gw.fetch);
      await expect(signer.signTypedData(e)).rejects.toThrow(/65-byte/);
    });

    it("aborts (throws) when the gateway never responds — timeout", async () => {
      const hanging = ((
        _input: Parameters<typeof fetch>[0],
        init?: RequestInit,
      ) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        })) as typeof fetch;
      await expect(
        GatewayHttpSigner.create(BASE, BEARER, hanging, 10),
      ).rejects.toThrow(/failed/);
    });
  });
});
