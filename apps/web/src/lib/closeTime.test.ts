import { describe, expect, it } from "vitest";
import { formatCloseLabel } from "./closeTime";

const now = new Date("2026-10-02T12:00:00.000Z");

describe("formatCloseLabel", () => {
  it("returns empty text when no close time is set", () => {
    expect(formatCloseLabel(null, now)).toBe("");
    expect(formatCloseLabel(undefined, now)).toBe("");
    expect(formatCloseLabel("", now)).toBe("");
  });

  it("returns empty text for an unparseable value", () => {
    expect(formatCloseLabel("nope", now)).toBe("");
  });

  it("uses 'Closes on' with date, time and zone for a future time", () => {
    const label = formatCloseLabel("2026-11-21T14:30:00.000Z", now);
    expect(label).toMatch(/^Closes on 2[12] Nov 2026, \d{1,2}:\d{2} (AM|PM) \S+/);
  });

  it("uses 'Closed on' once the time has passed", () => {
    const label = formatCloseLabel("2026-09-01T10:00:00.000Z", now);
    expect(label).toMatch(/^Closed on \d{1,2} Sep 2026, /);
  });

  it("accepts epoch milliseconds", () => {
    expect(formatCloseLabel(Date.parse("2026-11-21T14:30:00Z"), now)).toMatch(/^Closes on /);
  });
});
