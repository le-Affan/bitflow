import { describe, expect, it } from "vitest";

import { shorten } from "../../src/lib/shorten";

// Synthetic strings shaped like addresses (bech32-like 42 chars, base58-like 34 chars); not stored data.
describe("shorten", () => {
  it("keeps first 6 and last 4 characters", () => {
    expect(shorten("bc1qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1234")).toBe("bc1qxx…1234");
    expect(shorten("1Abcdefghijkmnopqrstuvwxyz12345678")).toBe("1Abcde…5678");
  });

  it("leaves short values unchanged", () => {
    expect(shorten("")).toBe("");
    expect(shorten("abcdefghij")).toBe("abcdefghij"); // 10 chars
    expect(shorten("abcdefghijk")).toBe("abcdefghijk"); // 11 chars: shortening would not save anything
    expect(shorten("abcdefghijkl")).toBe("abcdef…ijkl");
  });

  it("supports custom lengths", () => {
    expect(shorten("0123456789abcdef0123", 8, 6)).toBe("01234567…ef0123");
  });
});
