/**
 * Respondent-email format check for the public form.
 *
 * Absorbed into the shared `validation.ts` module (which mirrors the server's
 * per-type rules). Re-exported here so existing imports keep working.
 */
export { isValidEmail } from "./validation";
