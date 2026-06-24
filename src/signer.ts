import { ethers } from "ethers";

import type { OrderEip712Digest } from "./encode.js";

/** The sole abstraction that can produce a signature over a UniswapX order's EIP-712 hashes. */
export interface Signer {
  /** Address whose key signs — used for the pre-sign swapper bind and the post-sign recover-verify. */
  readonly address: string;
  /**
   * Sign a UniswapX order's EIP-712 hashes. Implementations sign the raw
   * `eip712.digest` (`keccak256(0x1901 ‖ domainSeparator ‖ structHash)`). The full triple is
   * carried — not just the digest — because the live gateway impl forwards the two component
   * hashes to Core, and keccak is one-way: they cannot be recovered from the digest.
   */
  signTypedData(eip712: OrderEip712Digest): Promise<string>;
}

/**
 * Hermetic dev-key signer for tests — NOT for production (real keys live in the Rust core).
 * Signs the **raw digest** via `SigningKey.signDigest`, matching core's `SignTypedData` which
 * signs `keccak256(0x1901 ‖ domainSeparator ‖ structHash)`. It must NOT use
 * `signMessage`/`_signTypedData`, which prefix/re-hash and would sign the wrong bytes.
 */
export class DevKeyringSigner implements Signer {
  readonly #key: ethers.utils.SigningKey;
  readonly address: string;

  constructor(privateKey: string) {
    this.#key = new ethers.utils.SigningKey(privateKey);
    this.address = ethers.utils.computeAddress(this.#key.publicKey);
  }

  async signTypedData(eip712: OrderEip712Digest): Promise<string> {
    return ethers.utils.joinSignature(this.#key.signDigest(eip712.digest));
  }
}
