import { describe, expect, it } from "vitest";

import { customRange, presetRange } from "../../src/components/ControlsPanel";

// All dates are synthetic test inputs.
describe("preset ranges end on the latest stored day", () => {
  it("week = 7 days, month = 30 days, year = 365 days, both ends included", () => {
    expect(presetRange("2026-10-09", 7)).toEqual({ start: "2026-10-03", end: "2026-10-09" });
    expect(presetRange("2026-10-09", 30)).toEqual({ start: "2026-09-10", end: "2026-10-09" });
    expect(presetRange("2026-10-09", 365)).toEqual({ start: "2025-10-10", end: "2026-10-09" });
    expect(presetRange("2024-03-01", 7)).toEqual({ start: "2024-02-24", end: "2024-03-01" }); // leap year
  });
});

describe("custom range", () => {
  it("keeps a range that starts on or after the first Bitcoin block", () => {
    expect(customRange("2020-01-01", "2020-01-01")).toEqual({ start: "2020-01-01", end: "2020-01-01" });
    expect(customRange("2009-01-03", "2020-01-01")).toEqual({ start: "2009-01-03", end: "2020-01-01" });
  });

  it("moves a start before the first Bitcoin block to 2009-01-03", () => {
    expect(customRange("2008-06-01", "2009-02-01")).toEqual({ start: "2009-01-03", end: "2009-02-01" });
    expect(customRange("2008-01-01", "2008-06-01")).toEqual({ start: "2008-01-01", end: "2008-06-01" }); // all before
  });
});
