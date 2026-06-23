import { ethers } from "ethers";

/** The sole abstraction that can produce a signature over an EIP-712 digest. */
export interface Signer {
  /** Address whose key signs — used for recover-verify. */
  readonly address: string;
  /** Sign the raw 32-byte EIP-712 digest. */
  signDigest(digest: string): Promise<string>;
}

/**
 * Hermetic dev-key signer for the Slice-1 harness — NOT for production (real keys live in
 * the Rust core). Signs the **raw digest** via `SigningKey.signDigest`, matching core's
 * `SignTypedData` which signs `keccak256(0x1901 ‖ domainSeparator ‖ structHash)`. It must
 * NOT use `signMessage`/`_signTypedData`, which prefix/re-hash and would sign the wrong bytes.
 */
export class DevKeyringSigner implements Signer {
  readonly #key: ethers.utils.SigningKey;
  readonly address: string;

  constructor(privateKey: string) {
    this.#key = new ethers.utils.SigningKey(privateKey);
    this.address = ethers.utils.computeAddress(this.#key.publicKey);
  }

  async signDigest(digest: string): Promise<string> {
    return ethers.utils.joinSignature(this.#key.signDigest(digest));
  }
}
