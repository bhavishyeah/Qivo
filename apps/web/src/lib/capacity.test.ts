import { describe, it, expect } from "vitest";
import {
  isScheduleClosed,
  isFullyBooked,
  shouldShowSeatsCounter,
  seatsLeftLabel,
} from "./capacity";
import type { PublicForm } from "../types";

type Cap = PublicForm["capacity"];

const now = new Date("2026-10-02T12:00:00.000Z");

describe("isScheduleClosed", () => {
  it("is false when no close date is set", () => {
    expect(isScheduleClosed({}, now)).toBe(false);
    expect(isScheduleClosed(undefined, now)).toBe(false);
  });

  it("is true once the close time has passed", () => {
    expect(
      isScheduleClosed({ scheduledCloseAt: "2026-10-02T11:00:00.000Z" }, now),
    ).toBe(true);
  });

  it("is false before the close time", () => {
    expect(
      isScheduleClosed({ scheduledCloseAt: "2026-10-02T13:00:00.000Z" }, now),
    ).toBe(false);
  });

  it("is false for an unparseable close date (never silently closes)", () => {
    expect(isScheduleClosed({ scheduledCloseAt: "not-a-date" }, now)).toBe(
      false,
    );
  });
});

describe("isFullyBooked — precedence + seats", () => {
  const full: Cap = { enabled: true, limit: 120, submitted: 120, seatsLeft: 0 };
  const open: Cap = { enabled: true, limit: 120, submitted: 78, seatsLeft: 42 };

  it("shows the card when capacity is on and 0 seats remain at load", () => {
    expect(isFullyBooked(full, false, false)).toBe(true);
  });

  it("does NOT show the card when seats remain", () => {
    expect(isFullyBooked(open, false, false)).toBe(false);
  });

  it("shows the card when a submit raced to full (flag), even with stale seats", () => {
    expect(isFullyBooked(open, true, false)).toBe(true);
  });

  it("is false when capacity is disabled", () => {
    expect(isFullyBooked({ enabled: false }, false, false)).toBe(false);
    expect(isFullyBooked(undefined, false, false)).toBe(false);
  });

  it("scheduled-close takes precedence: never shows the fully-booked card (AC-11)", () => {
    expect(isFullyBooked(full, false, true)).toBe(false);
    expect(isFullyBooked(open, true, true)).toBe(false);
  });
});

describe("shouldShowSeatsCounter", () => {
  it("shows the counter when enabled and seats remain", () => {
    expect(
      shouldShowSeatsCounter({ enabled: true, limit: 120, seatsLeft: 42 }),
    ).toBe(true);
  });

  it("hides the counter at 0 seats (the fully-booked card handles that)", () => {
    expect(
      shouldShowSeatsCounter({ enabled: true, limit: 120, seatsLeft: 0 }),
    ).toBe(false);
  });

  it("hides the counter when capacity is disabled or absent", () => {
    expect(shouldShowSeatsCounter({ enabled: false })).toBe(false);
    expect(shouldShowSeatsCounter(undefined)).toBe(false);
  });
});

describe("seatsLeftLabel", () => {
  it("formats 'X of N seats left'", () => {
    expect(
      seatsLeftLabel({ enabled: true, limit: 120, seatsLeft: 42 }),
    ).toBe("42 of 120 seats left");
  });

  it("falls back to 0 for missing values", () => {
    expect(seatsLeftLabel({ enabled: true })).toBe("0 of 0 seats left");
  });
});
