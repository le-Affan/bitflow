import { describe, expect, it } from "vitest";

import { shorten } from "../../src/lib/shorten";

describe("shorten", () => {
  it("keeps first 6 and last 4 characters", () => {
    expect(shorten("bc1qan4zp4ek0mjn258xe29v8f8w7nq00jf2nu9dqz")).toBe("bc1qan…9dqz");
    expect(shorten("12hrgWCMVrwgDArJvV2ypwTKgfyNqUNkRH")).toBe("12hrgW…NkRH");
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
