import { describe, expect, it } from "vitest";

import { NAME } from "../src/index.js";

describe("scaffold", () => {
  it("exposes the package identity", () => {
    expect(NAME).toBe("@rustok-org/uniswap");
  });
});
