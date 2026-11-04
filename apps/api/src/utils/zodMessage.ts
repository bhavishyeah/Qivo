import type { z } from "zod";

// Friendly names for fields whose Zod default message is unhelpful on its own.
const FRIENDLY_FIELD_NAMES: Record<string, string> = {
  email: "Email address",
  url: "URL",
  answers: "Answers",
  password: "Password",
  title: "Title",
};

// Zod's built-in messages ("Invalid email address", "Too small: ...",
// "Invalid input: ...") start with one of these. Anything else is a message a
// schema author wrote on purpose and is already user-facing.
function isDefaultZodMessage(message: string): boolean {
  return /^(Invalid |Too small|Too big)/.test(message);
}

function humanizeFieldName(path: ReadonlyArray<PropertyKey>): string {
  const last = [...path].reverse().find((segment) => typeof segment === "string");
  if (typeof last !== "string") return "";
  const known = FRIENDLY_FIELD_NAMES[last];
  if (known) return known;
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Turn a ZodError into one human-readable sentence built from its FIRST issue.
 * Custom schema messages (e.g. "Webhook URL must use https.") pass through
 * unchanged; Zod's generic defaults get a friendly field name in front.
 */
export function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request data.";

  const lastSegment = [...issue.path].reverse().find((s) => typeof s === "string");
  if (lastSegment === "email" && issue.code === "invalid_format") {
    return "Please enter a valid email address.";
  }

  if (!isDefaultZodMessage(issue.message)) return issue.message;

  const name = humanizeFieldName(issue.path);
  return name ? `${name}: ${issue.message}` : issue.message;
}
