import type { AnswerValue, Question } from "../types";

/**
 * Client-side format validation that MIRRORS the API's per-type rules
 * (apps/api/src/modules/forms/form.service.ts `validateAnswerAgainstQuestion`
 * and the top-level `email` Zod rule). The public form is rendered `noValidate`,
 * so without this the server rejects a malformed value with a 400 and the
 * respondent sees only a generic error. Keeping these two layers in lockstep
 * means the client never lets through what the server would reject.
 *
 * Every helper here is pure and unit-tested. Empty values are treated as valid
 * (format checks apply only to non-empty input); required-ness is enforced
 * separately by the caller, matching the server which skips empty answers.
 */

// Mirrors the `email` rule in the API submitResponseSchema (Zod z.email()):
// a dotted domain with an alphabetic TLD, no leading/consecutive dots.
const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Lenient phone rule. Keep identical to isValidPhoneNumber in
 * apps/api/src/modules/forms/form.service.ts: only digits, spaces, `+`, `-`,
 * `(`, `)`, `.`, and 7-15 digits in total. Rejects obvious garbage without
 * blocking international formats.
 */
export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[0-9\s+\-().]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

// Mirrors the server's `new URL(value)` check.
export function isValidUrl(value: string): boolean {
  try {
    new URL(value.trim());
    return true;
  } catch {
    return false;
  }
}

// Mirrors the server's NUMBER/RATING/LINEAR_SCALE numeric check.
export function isValidNumber(value: AnswerValue | undefined): boolean {
  if (typeof value === "number") return !Number.isNaN(value);
  const num = Number(String(value));
  return !Number.isNaN(num);
}

// Mirrors the server's DATE check (`new Date(value)` is a real date).
export function isValidDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Validate a respondent-entered payment amount (in rupees, as typed) against
 * the form's bounds. Mirrors the server's `rupeesToPaise` discipline exactly:
 * finite number, non-negative, at most 2 decimal places, and within the
 * [minPaise, maxPaise] range (which the server resolves to concrete bounds).
 * On success returns the integer paise to send as `requestedAmount`; on failure
 * returns a friendly inline message. The caller blocks Checkout on failure.
 */
export function validatePaymentAmountRupees(
  input: string,
  minPaise: number,
  maxPaise: number,
): { ok: true; paise: number } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { ok: false, message: "Please enter an amount to pay." };
  }
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees)) {
    return { ok: false, message: "Please enter a valid amount." };
  }
  if (rupees < 0) {
    return { ok: false, message: "Amount must not be negative." };
  }
  const paise = Math.round(rupees * 100);
  // Reject >2-decimal inputs: the rounded paise must reproduce the rupee value.
  if (Math.abs(paise / 100 - rupees) > 1e-9) {
    return { ok: false, message: "Amount must have at most 2 decimal places." };
  }
  if (paise < minPaise || paise > maxPaise) {
    const minRs = (minPaise / 100).toLocaleString("en-IN");
    const maxRs = (maxPaise / 100).toLocaleString("en-IN");
    return {
      ok: false,
      message: `Enter an amount between ₹${minRs} and ₹${maxRs}.`,
    };
  }
  return { ok: true, paise };
}

/**
 * Validate a single question's VALUE for format (not required-ness). Returns a
 * friendly message, or null when the value is empty or valid. Only text-like
 * question types have a format to check; choice/upload types are validated by
 * their UI and the server's stricter checks.
 */
export function validateQuestionFormat(
  question: Question,
  value: AnswerValue | undefined,
): string | null {
  // Empty optional/required-but-empty values are not a FORMAT error here.
  if (value === undefined || value === null || value === "") return null;

  switch (question.type) {
    case "EMAIL":
      return typeof value === "string" && isValidEmail(value)
        ? null
        : "Please enter a valid email address, like name@example.com.";

    case "URL":
      return typeof value === "string" && isValidUrl(value)
        ? null
        : "Please enter a valid web address starting with http:// or https://.";

    case "PHONE":
      return typeof value === "string" && isValidPhone(value)
        ? null
        : "Please enter a valid phone number.";

    case "NUMBER":
    case "RATING":
    case "LINEAR_SCALE":
      return isValidNumber(value) ? null : "Please enter a number.";

    case "DATE":
      return typeof value === "string" && isValidDate(value)
        ? null
        : "Please enter a valid date.";

    case "MULTI_ENTRY":
      // Non-blank entries only (mirrors the server). An all-blank array is
      // treated as empty elsewhere (required-check), so only flag a stray blank
      // among real entries.
      if (Array.isArray(value)) {
        const entries = value as string[];
        const hasReal = entries.some((e) => e.trim() !== "");
        if (hasReal && entries.some((e) => e.trim() === "")) {
          return "Please fill in or remove the empty entries.";
        }
      }
      return null;

    default:
      return null;
  }
}
