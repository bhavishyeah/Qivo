# Design Review — Email engagement features (Qivo)

Reviewed: `c:\Qivo\.agents\tasks\email-engagement\design.md`
Scope: two per-form Settings-panel email features (owner notification on new response; respondent confirmation email), plus a daily-digest sweep and a `lastDigestSentAt` migration.

This is a fresh, source-verified review. Every claim the design makes about existing code was checked against the actual files listed below. The design had already been through one prior review round (its "Responses to design review findings" section). This review re-verifies those resolutions against source rather than trusting them.

## Source files spot-checked

- `apps/api/src/server.ts` — timer, `PUBLISH_SWEEP_MS = 60_000`, `runPublishSweep`, import of `publishDueForms, closeDueForms`.
- `apps/api/src/modules/forms/form.schemas.ts` — `updateFormSettingsSchema`, `UpdateFormSettingsInput`.
- `apps/api/src/modules/forms/form.service.ts` — `FormSchema` type, `getFormSchema`, `updateFormSettings`, `getPublicForm`, `submitFormResponse`, `publishDueForms`, `closeDueForms`, `stripAnswerKeys`, `validateAnswerAgainstQuestion`.
- `apps/api/src/services/email.ts` — `sendEmail`, `layout`, `button`, `getWebUrl`, existing templates.
- `prisma/schema.prisma` — `Form` model, `User` relation.
- `prisma/migrations/` — directory listing + two precedent SQL files.
- `apps/web/src/types/index.ts` — form `settings` type.
- `apps/web/src/pages/FormEditorPage.tsx` — settings state, `loadEditor`, `saveFormSettings`, datetime helpers, Collection `SettingsGroup`.

---

## Gate checks (the concrete risks called out for this review)

**1. Daily digest idempotency — PASS.** The design does not rely on a vague "24h window." It adds a persisted `lastDigestSentAt DateTime?` anchor on `Form`, selects a form as due only when `lastDigestSentAt IS NULL OR lastDigestSentAt <= now − (24h − tolerance)`, and stamps `lastDigestSentAt = now` immediately after a send. I verified the server timer fires every 60s (`PUBLISH_SWEEP_MS = 60_000` in `server.ts`) and that `runPublishSweep` is the single sweep path, so the "re-send on every tick" risk is real and the persisted anchor is the correct mitigation. The "stamp only when count > 0" rule and the restart-survival argument (Postgres-persisted, not in-memory) are sound. The digest reads `f.lastDigestSentAt` directly off the Prisma row (via the `findMany` `select`), not out of the schema JSON — correct, since the column is not part of `schema.settings`.

**2. Public payload leak — PASS.** Verified `getPublicForm()` returns `schema: { version, sections: stripAnswerKeys(...), settings: schema.settings, confirmationMessage? }` — it does pass `settings` wholesale today. The design identifies this and strips both new keys via `const { responseNotification, sendConfirmationEmail, ...publicSettings } = schema.settings`. Because `getFormSchema` now always emits both keys (with defaults), the destructure reliably removes them. Owner-only `responseNotification` will not leak. PASS.

**3. submitFormResponse hook placement — PASS.** Verified the function creates the row via `prisma.formResponse.create(...)`, then runs an existing `void (async () => { … })().catch(...)` analytics/milestone block, and finally `return { ...response, quizScore };`. The design places both new email side-effects as independent fire-and-forget `.catch` blocks in that same post-create region, so they fire AFTER the row is saved and can never break submission or alter the return value. Confirmation is gated on `sendConfirmationEmail === true && collectEmail === true && respondent email present`, and reuses `normalizedEmail` (the already lowercased/trimmed value) — both verified to exist exactly as described.

**4. No-op without Resend — PASS.** Verified `sendEmail` logs to console and swallows errors when `RESEND_API_KEY` is unset, and never throws. All three new template functions route through `sendEmail`, so every email path no-ops cleanly without Resend.

**5. Frontend — PASS.** Verified `FormEditorPage.tsx` has the settings state hooks, `loadEditor` `setX(schema.settings?....)` calls, the `saveFormSettings` PATCH body, the `toIsoInstant`/`toDatetimeLocal` helpers, and the Collection `SettingsGroup` with the `collectEmail` toggle. The design adds the two fields to state/load/save, disables the confirmation checkbox when `collectEmail` is off, and leaves the datetime helpers untouched. The `settings` type in `apps/web/src/types/index.ts` lists exactly the fields named, and the design extends it with the two optional keys.

---

## Findings

1. **(NIT) Zod `UpdateFormSettingsInput` is non-partial; new optional fields are consistent but the PATCH already requires `confirmationMessage`.** In `form.schemas.ts`, `updateFormSettingsSchema` declares `collectEmail`, `allowMultipleResponses`, and `confirmationMessage` as *required* (not `.optional()`). The design's `updateFormSettings` merge uses `input.responseNotification !== undefined ? … : {}` guards, which implies the field may be absent — correct for the two new `.optional()` fields. No conflict, but the implementer should note the existing PATCH contract already demands `collectEmail`/`allowMultipleResponses`/`confirmationMessage` on every call (the web `saveFormSettings` already sends all three), so the "omit to leave untouched" behavior the design describes applies only to the genuinely optional fields. Fix: no change to the design; when implementing, keep both new fields `.optional()` exactly as specified and do not loosen the existing required fields.

2. **(NIT) `MULTIPLE_CHOICE` can arrive as a plain string, not only an array.** The confirmation-email render table (Decision 4 / Feature B) lists `MULTIPLE_CHOICE` under "array." Verified in `validateAnswerAgainstQuestion`: `MULTIPLE_CHOICE` accepts `isArray ? value : [value]`, so a single selection may reach the blob as a bare string. The design's render table still handles this correctly because the "plain string" row is the catch-all, but the label "array (e.g. … multi-select)" is slightly misleading. Fix: in the render helper, treat `MULTIPLE_CHOICE` defensively for both shapes — `Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v)` — rather than assuming an array.

3. **(NIT) Immediate-notification owner lookup does not filter by email presence.** Feature A.1 fetches `prisma.user.findUnique({ where: { id: form.ownerId }, select: { email: true, name: true } })`. The `User.email` column is non-nullable (`email String @unique` in `schema.prisma`), so an owner always has an email — the only failure mode is a missing row, already covered by the block's `.catch`. No correctness problem. Fix: none required; optionally guard `if (!owner?.email) return;` for symmetry with the digest path, which the edge-case table already implies.

---

## Verdict rationale

All five gated risks PASS. The three findings are NIT (robustness/clarity only, none block implementation and none affect the verdict count). HIGH count = 0, MEDIUM count = 0 → **APPROVED**.

---

## Verified Assumptions

- `server.ts`: single `setInterval` sweep at `PUBLISH_SWEEP_MS = 60_000`, `runPublishSweep` wraps `publishDueForms()`/`closeDueForms()`, imports those two from `form.service.js`. The design's "reuse the existing sweep, no new timer" plan is feasible. VERIFIED.
- `getPublicForm()` returns `settings: schema.settings` wholesale — the leak the design strips is real. VERIFIED.
- `submitFormResponse()` structure: create row → existing fire-and-forget analytics/milestone `void (async()=>{})().catch(...)` → quiz scoring → `return { ...response, quizScore }`. Placement region for the new blocks exists as described. VERIFIED.
- `normalizedEmail = input.email?.trim().toLowerCase()` is computed before the create, and `collectEmail` hard-requires an email earlier (`EMAIL_REQUIRED`). Reuse-the-normalized-email instruction is accurate. VERIFIED.
- `sendEmail` no-ops to console and never throws without `RESEND_API_KEY`; `layout`, `button`, `getWebUrl` exist and are reusable. VERIFIED.
- Existing form-share emails link VIEWER role to `${webUrl}/forms/${formId}/responses` and RESPONDER to `${webUrl}/f/${slug}` — the design reuses the same destinations. VERIFIED.
- `prisma/schema.prisma`: `Form` has scalar fields incl. `deletedAt DateTime?`; `owner User @relation(... references:[id])`; `User.email` is non-nullable unique. Adding `lastDigestSentAt DateTime?` to `Form` is consistent. VERIFIED.
- Prisma lives only at repo root `c:\Qivo\prisma\` (generator `output = "../apps/api/src/generated/prisma"`); there is no `apps/api/prisma/`. VERIFIED (directory listing + schema header).
- Migration directory listing: highest existing prefix is `20260926000100_add_form_share`. The chosen `20260927000000_add_form_last_digest_sent_at` sorts strictly after all siblings. VERIFIED.
- Migration SQL convention: `20260822082301_add_workspace_branding/migration.sql` is `-- AlterTable` + `ALTER TABLE "Workspace" ADD COLUMN     "logoUrl" TEXT,` (double space after `ADD COLUMN`, `TIMESTAMP(3)` style used elsewhere). The design's proposed `ALTER TABLE "Form" ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3);` matches the convention exactly. VERIFIED.
- `validateAnswerAgainstQuestion` accepts `YES_NO` as `"yes"`/`"no"`/boolean, and `FILE_UPLOAD` as a `^https?://` URL — the design's defensive-render rules align with these shapes. VERIFIED.
- `apps/web/src/types/index.ts` `settings` type lists `collectEmail`, `allowMultipleResponses`, `scheduledPublishAt?`, `scheduledCloseAt?`, `quizMode?`, `showScore?` — exactly the baseline the design extends. VERIFIED.
- `FormEditorPage.tsx`: settings state hooks, `loadEditor` setters, `saveFormSettings` PATCH to `/api/forms/${formId}/settings`, `toIsoInstant`/`toDatetimeLocal` helpers, and the Collection `SettingsGroup` with the `collectEmail` toggle all exist as the design assumes. VERIFIED.

## Unverified / Wrong Assumptions

- None. Every source claim in the design was confirmed against the actual files. The design's own "Responses to design review findings" section (prior round) was independently re-verified: the Prisma-path correction, the migration-prefix ordering, the SQL double-space style, the `getFormSchema` private-function constraint, the allow-list load-bearing note, the `slug` availability in `submitFormResponse`, the `YES_NO` dual-shape handling, and the digest `since`-default are all accurate against source.
