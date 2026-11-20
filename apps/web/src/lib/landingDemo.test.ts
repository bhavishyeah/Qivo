import { describe, expect, it } from "vitest";
import {
  backToQuestions,
  continueToPay,
  DEMO_SEATS_START,
  formatRupees,
  initialDemoState,
  resetDemo,
  seatsText,
  setDemoField,
  submitDemo,
  validateQuestions,
} from "./landingDemo";

function filled() {
  let s = initialDemoState();
  s = setDemoField(s, "name", "Asha Verma");
  s = setDemoField(s, "year", "2nd year");
  s = setDemoField(s, "track", "Web");
  return s;
}

describe("landingDemo", () => {
  it("starts on the questions stage with the starting seats", () => {
    const s = initialDemoState();
    expect(s.stage).toBe("questions");
    expect(s.seatsLeft).toBe(DEMO_SEATS_START);
  });

  it("reports an error for each missing answer and stays on questions", () => {
    const s = continueToPay(initialDemoState());
    expect(s.stage).toBe("questions");
    expect(Object.keys(s.errors).sort()).toEqual(["name", "track", "year"]);
  });

  it("rejects a blank or over-long name", () => {
    expect(validateQuestions({ ...filled(), name: "   " }).name).toBeDefined();
    expect(validateQuestions({ ...filled(), name: "a".repeat(61) }).name).toBeDefined();
    expect(validateQuestions(filled())).toEqual({});
  });

  it("clears only the edited field's error", () => {
    const s = setDemoField(continueToPay(initialDemoState()), "name", "A");
    expect(s.errors.name).toBeUndefined();
    expect(s.errors.year).toBeDefined();
  });

  it("moves to pay when valid, and back again", () => {
    const pay = continueToPay(filled());
    expect(pay.stage).toBe("pay");
    expect(backToQuestions(pay).stage).toBe("questions");
  });

  it("does not continue when no seats are left", () => {
    expect(continueToPay({ ...filled(), seatsLeft: 0 }).stage).toBe("questions");
  });

  it("rejects a bad UTR and keeps seats unchanged", () => {
    const s = submitDemo(setDemoField(continueToPay(filled()), "utr", "123"));
    expect(s.stage).toBe("pay");
    expect(s.errors.utr).toBeDefined();
    expect(s.seatsLeft).toBe(DEMO_SEATS_START);
  });

  it("submits with a valid UTR and takes one seat", () => {
    const s = submitDemo(setDemoField(continueToPay(filled()), "utr", "UTR12345678"));
    expect(s.stage).toBe("done");
    expect(s.seatsLeft).toBe(DEMO_SEATS_START - 1);
  });

  it("ignores submit outside the pay stage and never goes below zero", () => {
    expect(submitDemo(filled()).stage).toBe("questions");
    const last = submitDemo({ ...continueToPay({ ...filled(), seatsLeft: 1 }), utr: "UTR12345678" });
    expect(last.seatsLeft).toBe(0);
  });

  it("does not mutate its input and resets to the start", () => {
    const before = filled();
    const snapshot = JSON.stringify(before);
    continueToPay(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(resetDemo()).toEqual(initialDemoState());
  });

  it("formats seats and rupees", () => {
    expect(seatsText(12)).toBe("12 of 40 seats left");
    expect(seatsText(1)).toBe("1 of 40 seats left");
    expect(seatsText(0)).toBe("No seats left");
    expect(formatRupees(200)).toBe("\u20B9200");
    expect(formatRupees(12500)).toBe("\u20B912,500");
  });
});
