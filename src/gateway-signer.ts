import { ethers } from "ethers";

import type { OrderEip712Digest } from "./encode.js";
import type { Signer } from "./signer.js";

type FetchLike = typeof fetch;

/** Default per-request timeout for gateway calls (ms). */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Live `Signer` that signs UniswapX orders through the Rust gateway's
 * `POST /api/v1/wallet/sign_typed_data` route, which forwards the two EIP-712 hashes to
 * Core (where the wallet key lives). The signer holds **no signing key** — only the gateway
 * Bearer (credential #2) and the wallet's public address, fetched once at construction.
 *
 * Built via the async {@link GatewayHttpSigner.create} factory because the address comes from
 * `GET /api/v1/wallet/context` yet `Signer.address` is a sync field.
 */
export class GatewayHttpSigner implements Signer {
  readonly address: string;
  readonly #baseUrl: string;
  readonly #bearer: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  private constructor(
    address: string,
    baseUrl: string,
    bearer: string,
    timeoutMs: number,
    fetchImpl: FetchLike,
  ) {
    this.address = address;
    this.#baseUrl = baseUrl;
    this.#bearer = bearer;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  /**
   * Fetch the wallet's own address from the gateway and build the signer. Fail-closed:
   * throws if the gateway is unreachable / unauthenticated (non-2xx), times out, or returns
   * anything but a valid Ethereum address — the signer is never constructed with an unknown
   * identity (the pre-sign swapper bind and post-sign recover-verify both rely on `address`).
   *
   * @param fetchImpl injectable for tests; defaults to the global `fetch`.
   */
  static async create(
    baseUrl: string,
    bearer: string,
    fetchImpl: FetchLike = fetch,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<GatewayHttpSigner> {
    const base = trimTrailingSlash(baseUrl);
    const body = await gatewayJson(
      fetchImpl,
      `${base}/api/v1/wallet/context`,
      { method: "GET", headers: { authorization: `Bearer ${bearer}` } },
      timeoutMs,
    );
    const rawAddress = (body as { address?: unknown }).address;
    if (typeof rawAddress !== "string") {
      throw new Error("gateway /wallet/context: missing string `address`");
    }
    // getAddress throws on a malformed / non-checksummable address — fail closed.
    const address = ethers.utils.getAddress(rawAddress);
    return new GatewayHttpSigner(address, base, bearer, timeoutMs, fetchImpl);
  }

  /**
   * Build from environment — the single live edge that owns env. Reads `process.env`
   * **lazily, inside the function** (never at module scope), so importing this module with an
   * empty gateway env (e.g. unit tests) never throws.
   */
  static async fromEnv(
    fetchImpl: FetchLike = fetch,
  ): Promise<GatewayHttpSigner> {
    const baseUrl = requireEnv("RUSTOK_GATEWAY_URL");
    const bearer = requireEnv("RUSTOK_MCP_API_KEY");
    return GatewayHttpSigner.create(baseUrl, bearer, fetchImpl);
  }

  async signTypedData(eip712: OrderEip712Digest): Promise<string> {
    const body = await gatewayJson(
      this.#fetch,
      `${this.#baseUrl}/api/v1/wallet/sign_typed_data`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          domain_separator: eip712.domainSeparator,
          struct_hash: eip712.structHash,
        }),
      },
      this.#timeoutMs,
    );
    const raw = (body as { signature?: unknown }).signature;
    if (typeof raw !== "string") {
      throw new Error("gateway /sign_typed_data: missing string `signature`");
    }
    // Gateway returns r||s||v as hex WITHOUT the 0x prefix; prepend it for ethers recover.
    const signature = `0x${raw}`;
    // 65 bytes = 130 hex chars. Fail closed on any other shape (empty / short / non-hex).
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error(
        `gateway /sign_typed_data: signature is not 65-byte hex (got ${raw.length} hex chars)`,
      );
    }
    return signature;
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the live gateway signer`);
  }
  return value;
}

/**
 * Call a gateway JSON endpoint with an abort timeout. Fail-closed: throws on transport error,
 * timeout, or any non-2xx status — the caller never proceeds on a failed signing request.
 */
async function gatewayJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new Error(`gateway request to ${url} failed`, { cause: err });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`gateway ${url} returned ${res.status}`);
  }
  return res.json();
}
