import { describe, expect, it } from "vitest";

import {
  addDays, addMonths, clampYearMonth, daysInMonth, isLeapYear, isSelectable, isValidYmd, longLabel, monthGrid,
  moveToMonth, parseYmd, todayUtc, weekdayIndex,
} from "../../src/lib/dates";

// All dates here are synthetic test inputs. "Today" is always injected; the suite runs under
// TZ=UTC, Asia/Kolkata and America/Los_Angeles (npm run test:tz) and must give identical results.
const TODAY = "2026-10-10";

describe("time zone", () => {
  it("reports which process time zone this run uses", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBeTruthy();
  });

  it("todayUtc uses the UTC date even when the local date differs", () => {
    // 20:00 UTC on 10 Oct is already 11 Oct 01:30 in Asia/Kolkata.
    expect(todayUtc(new Date("2026-10-10T20:00:00Z"))).toBe("2026-10-10");
    // 03:00 UTC on 11 Oct is still 10 Oct 20:00 in America/Los_Angeles.
    expect(todayUtc(new Date("2026-10-11T03:00:00Z"))).toBe("2026-10-11");
    expect(todayUtc(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
    expect(todayUtc(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01-01");
  });

  it("displayed days never shift: helpers work on strings only", () => {
    expect(longLabel("2026-10-09")).toBe("Friday, 9 October 2026");
    expect(addDays("2026-10-09", 0)).toBe("2026-10-09");
    expect(monthGrid({ year: 2026, month: 10 }).flat().filter(Boolean)[8]).toBe("2026-10-09");
    expect(weekdayIndex("2026-10-09")).toBe(4); // Friday (Monday = 0)
  });
});

describe("validation", () => {
  it.each(["2026-10-09", "2024-02-29", "2000-02-29", "1600-02-29", "2009-01-03", "1900-02-28", "0001-01-01", "1066-10-14"])(
    "accepts %s", (d) => expect(isValidYmd(d)).toBe(true));

  it.each(["2026-02-29", "1900-02-29", "2100-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "0000-01-01",
           "2026-1-01", "26-10-09", "2026/10/09", "", "2026-10-09T00:00:00Z", "yesterday"])(
    "rejects %s", (d) => expect(isValidYmd(d)).toBe(false));

  it("leap years", () => {
    expect([2024, 2000, 1600, 4].map(isLeapYear)).toEqual([true, true, true, true]);
    expect([2026, 1900, 2100, 1].map(isLeapYear)).toEqual([false, false, false, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("parses fields", () => {
    expect(parseYmd("0042-03-05")).toEqual({ year: 42, month: 3, day: 5 });
  });
});

describe("selectable dates (not after today UTC, no lower limit)", () => {
  it("accepts today and arbitrary past dates, including leap days and very old years", () => {
    for (const d of [TODAY, "2026-10-09", "2024-02-29", "2009-01-03", "1600-02-29", "0001-01-01"]) {
      expect(isSelectable(d, TODAY)).toBe(true);
    }
  });

  it("rejects tomorrow and any later date", () => {
    expect(isSelectable(addDays(TODAY, 1), TODAY)).toBe(false);
    for (const d of ["2026-10-11", "2026-11-01", "2027-01-01", "9999-12-31"]) expect(isSelectable(d, TODAY)).toBe(false);
  });

  it("rejects invalid strings", () => {
    expect(isSelectable("2026-02-30", TODAY)).toBe(false);
  });

  it("uses the injected UTC today, not the local date", () => {
    const now = new Date("2026-10-10T20:00:00Z"); // local date is already 11 Oct in Asia/Kolkata
    expect(isSelectable("2026-10-11", todayUtc(now))).toBe(false);
    expect(isSelectable("2026-10-10", todayUtc(now))).toBe(true);
  });
});

describe("day arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("1900-03-01", -1)).toBe("1900-02-28");
    expect(addDays("0001-01-01", 365)).toBe("0002-01-01");
    expect(addDays("2026-10-09", -7)).toBe("2026-10-02");
  });

  it("weekdays", () => {
    expect(weekdayIndex("2009-01-03")).toBe(5); // Saturday
    expect(weekdayIndex("2000-01-01")).toBe(5); // Saturday
    expect(weekdayIndex("1970-01-01")).toBe(3); // Thursday
  });
});

describe("month and year navigation", () => {
  it("moves by months and years", () => {
    expect(addMonths({ year: 2026, month: 10 }, 1)).toEqual({ year: 2026, month: 11 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(addMonths({ year: 2026, month: 10 }, -12 * 100)).toEqual({ year: 1926, month: 10 });
  });

  it("never navigates past the month of today", () => {
    expect(clampYearMonth({ year: 2026, month: 11 }, TODAY)).toEqual({ year: 2026, month: 10 });
    expect(clampYearMonth({ year: 2030, month: 1 }, TODAY)).toEqual({ year: 2026, month: 10 });
    expect(clampYearMonth({ year: 1999, month: 5 }, TODAY)).toEqual({ year: 1999, month: 5 });
  });

  it("keeps the day of month when moving, clamped to month length and to today", () => {
    expect(moveToMonth("2026-03-31", { year: 2026, month: 2 }, TODAY)).toBe("2026-02-28");
    expect(moveToMonth("2024-01-31", { year: 2024, month: 2 }, TODAY)).toBe("2024-02-29");
    expect(moveToMonth("2026-09-25", { year: 2026, month: 10 }, TODAY)).toBe(TODAY);
    expect(moveToMonth("2026-09-25", { year: 2027, month: 3 }, TODAY)).toBe(TODAY);
    expect(moveToMonth("2026-10-09", { year: 1850, month: 10 }, TODAY)).toBe("1850-10-09");
  });

  it("month grid starts on Monday and covers every day", () => {
    const grid = monthGrid({ year: 2026, month: 2 }); // 1 Feb 2026 is a Sunday
    expect(grid[0]).toEqual([null, null, null, null, null, null, "2026-02-01"]);
    expect(grid.flat().filter(Boolean)).toHaveLength(28);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid({ year: 2024, month: 2 }).flat().filter(Boolean)).toHaveLength(29);
  });
});
