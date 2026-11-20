import { isValidUtr } from "./manualUpi";

/** State logic for the landing-page sample form. Pure: no React, no DOM, no network. */

export const DEMO_SEATS_TOTAL = 40;
export const DEMO_SEATS_START = 12;
export const DEMO_FEE_RUPEES = 200;
export const DEMO_YEARS = ["1st year", "2nd year", "3rd year", "Final year"] as const;
export const DEMO_TRACKS = ["Web", "AI and ML", "Design"] as const;

export type DemoStage = "questions" | "pay" | "done";
export type DemoField = "name" | "year" | "track" | "utr";
export type DemoErrors = Partial<Record<DemoField, string>>;

export type DemoState = {
  stage: DemoStage;
  name: string;
  year: string | null;
  track: string | null;
  utr: string;
  seatsLeft: number;
  errors: DemoErrors;
};

export function initialDemoState(): DemoState {
  return { stage: "questions", name: "", year: null, track: null, utr: "", seatsLeft: DEMO_SEATS_START, errors: {} };
}

export function setDemoField(s: DemoState, field: DemoField, value: string): DemoState {
  const errors = { ...s.errors };
  delete errors[field];
  return { ...s, [field]: value, errors };
}

export function validateQuestions(s: DemoState): DemoErrors {
  const errors: DemoErrors = {};
  const name = s.name.trim();
  if (name.length < 1 || name.length > 60) errors.name = "Enter your name.";
  if (!s.year || !(DEMO_YEARS as readonly string[]).includes(s.year)) errors.year = "Pick your year.";
  if (!s.track || !(DEMO_TRACKS as readonly string[]).includes(s.track)) errors.track = "Pick a track.";
  return errors;
}

export function continueToPay(s: DemoState): DemoState {
  if (s.stage !== "questions" || s.seatsLeft <= 0) return s;
  const errors = validateQuestions(s);
  if (Object.keys(errors).length > 0) return { ...s, errors };
  return { ...s, stage: "pay", errors: {} };
}

export function backToQuestions(s: DemoState): DemoState {
  if (s.stage !== "pay") return s;
  return { ...s, stage: "questions", errors: {} };
}

export function submitDemo(s: DemoState): DemoState {
  if (s.stage !== "pay") return s;
  if (!isValidUtr(s.utr)) {
    return { ...s, errors: { utr: "Enter the UTR from your UPI app (8 to 35 letters or digits)." } };
  }
  return { ...s, stage: "done", seatsLeft: Math.max(0, s.seatsLeft - 1), errors: {} };
}

export function resetDemo(): DemoState {
  return initialDemoState();
}

export function seatsText(seatsLeft: number, total: number = DEMO_SEATS_TOTAL): string {
  if (seatsLeft <= 0) return "No seats left";
  return `${seatsLeft} of ${total} seats left`;
}

export function formatRupees(rupees: number): string {
  return `\u20B9${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(rupees)}`;
}
