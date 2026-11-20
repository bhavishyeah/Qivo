import { describe, expect, it } from "vitest";
import {
  clampToMin,
  dateToParts,
  formatDisplay,
  formatLocalValue,
  nowLocalValue,
  parseLocalValue,
  partsToDate,
  stepMinute,
  to12Hour,
  to24Hour,
  wrapStep,
} from "./dateTimeValue";

describe("parseLocalValue / formatLocalValue", () => {
  it("round-trips the datetime-local string format", () => {
    const parts = parseLocalValue("2026-11-21T14:30");
    expect(parts).toEqual({ year: 2026, month: 11, day: 21, hour: 14, minute: 30 });
    expect(formatLocalValue(parts!)).toBe("2026-11-21T14:30");
  });

  it("zero-pads every field", () => {
    expect(formatLocalValue({ year: 2026, month: 1, day: 5, hour: 0, minute: 5 })).toBe("2026-01-05T00:05");
  });

  it("rejects empty, malformed and impossible values", () => {
    for (const bad of ["", "2026-11-21", "2026-11-21T14:30:00", "2026-13-01T10:00", "2026-02-31T10:00", "2026-11-21T24:00", "2026-11-21T10:60", "x"]) {
      expect(parseLocalValue(bad), bad).toBeNull();
    }
    expect(parseLocalValue(undefined)).toBeNull();
  });

  it("matches what new Date(...) and the editor's local-to-ISO conversion expect", () => {
    // The editor does new Date(value).toISOString(); the picker value must parse as local time.
    const value = "2026-11-21T14:30";
    const d = new Date(value);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
    const parts = dateToParts(d, d.getHours(), d.getMinutes());
    expect(formatLocalValue(parts)).toBe(value);
  });
});

describe("date helpers", () => {
  it("maps parts to a local calendar date and back", () => {
    const parts = parseLocalValue("2026-03-09T08:05")!;
    const d = partsToDate(parts);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 9]);
    expect(formatLocalValue(dateToParts(d, 8, 5))).toBe("2026-03-09T08:05");
  });

  it("formats the trigger text", () => {
    expect(formatDisplay("2026-11-21T14:30")).toBe("21 Nov 2026, 2:30 PM");
    expect(formatDisplay("2026-01-05T00:05")).toBe("5 Jan 2026, 12:05 AM");
    expect(formatDisplay("2026-01-05T12:00")).toBe("5 Jan 2026, 12:00 PM");
    expect(formatDisplay("")).toBe("");
    expect(formatDisplay("garbage")).toBe("");
  });

  it("builds the current time as a picker value", () => {
    expect(nowLocalValue(new Date(2026, 5, 7, 9, 4))).toBe("2026-06-07T09:04");
  });
});

describe("12-hour conversion", () => {
  it("converts both ways, including midnight and noon", () => {
    expect(to12Hour(0)).toEqual({ hour: 12, period: "AM" });
    expect(to12Hour(12)).toEqual({ hour: 12, period: "PM" });
    expect(to12Hour(13)).toEqual({ hour: 1, period: "PM" });
    expect(to12Hour(23)).toEqual({ hour: 11, period: "PM" });
    for (let h = 0; h < 24; h++) {
      const t = to12Hour(h);
      expect(to24Hour(t.hour, t.period)).toBe(h);
    }
  });
});

describe("clampToMin and wrapStep", () => {
  it("raises a value that is earlier than min and leaves others alone", () => {
    expect(clampToMin("2026-11-20T10:00", "2026-11-21T09:00")).toBe("2026-11-21T09:00");
    expect(clampToMin("2026-11-21T10:00", "2026-11-21T09:00")).toBe("2026-11-21T10:00");
    expect(clampToMin("2026-11-21T10:00", undefined)).toBe("2026-11-21T10:00");
    expect(clampToMin("2026-11-21T10:00", "")).toBe("2026-11-21T10:00");
  });

  it("steps minutes to the next multiple of five", () => {
    expect(stepMinute(30, 1)).toBe(35);
    expect(stepMinute(33, 1)).toBe(35);
    expect(stepMinute(33, -1)).toBe(30);
    expect(stepMinute(55, 1)).toBe(0);
    expect(stepMinute(0, -1)).toBe(55);
  });

  it("wraps steps within the range", () => {
    expect(wrapStep(12, 1, 1, 12)).toBe(1);
    expect(wrapStep(1, -1, 1, 12)).toBe(12);
    expect(wrapStep(55, 5, 0, 59)).toBe(0);
    expect(wrapStep(0, -5, 0, 59)).toBe(55);
  });
});