import { describe, expect, it } from "vitest";

import { formatBtc, formatSats } from "../../src/lib/btc";

// Pure function tests. All amounts are synthetic inputs chosen for their digits, not stored data.

describe("formatSats", () => {
  it.each([
    [0, "0.00000000"],
    [1, "0.00000001"],
    [10, "0.00000010"],
    [546, "0.00000546"],
    [99_999_999, "0.99999999"],
    [100_000_000, "1.00000000"],
    [100_000_001, "1.00000001"],
    [123_456_789_012, "1,234.56789012"],
    [100_000_000_000, "1,000.00000000"],
    [99_999_999_999_999, "999,999.99999999"],
    [2_099_999_997_690_000, "20,999,999.97690000"], // total supply
    [17_658_851_250_582, "176,588.51250582"], // 14-digit value, separators in the whole part
    [-150, "-0.00000150"],
  ])("%s sat -> %s", (sats, expected) => {
    expect(formatSats(sats)).toBe(expected);
  });

  it("never rounds: values that break float division stay exact", () => {
    // 0.1 + 0.2 style traps: 30000000 / 1e8 is fine, but these are not representable exactly as floats.
    expect(formatSats(2_100_000_000_000_001)).toBe("21,000,000.00000001");
    expect(formatSats(9_007_199_254_740_991)).toBe("90,071,992.54740991"); // Number.MAX_SAFE_INTEGER
    expect(formatSats(9_007_199_254_740_993n)).toBe("90,071,992.54740993"); // beyond safe range, as bigint
    expect(formatSats(29_000_000)).toBe("0.29000000");
    expect(formatSats(57_000_000)).toBe("0.57000000"); // 0.57 * 1e8 !== 57000000 in floating point
  });

  it("rejects non-integers and unsafe numbers instead of rounding", () => {
    expect(() => formatSats(0.5)).toThrow(RangeError);
    expect(() => formatSats(Number.NaN)).toThrow(RangeError);
    expect(() => formatSats(9_007_199_254_740_993)).toThrow(RangeError);
  });

  it("formatBtc appends the unit", () => {
    expect(formatBtc(1)).toBe("0.00000001 BTC");
  });
});
