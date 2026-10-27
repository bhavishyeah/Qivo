# Per-form email engagement — owner notifications + respondent confirmation

Adds two per-form Settings toggles to Qivo: `responseNotification` (`off` | `immediate` | `daily`) that emails the form owner on new responses, and `sendConfirmationEmail` that emails the respondent a copy of their submission. Both live in the existing `schema.settings` JSON blob and reuse the `email.ts` Resend wrapper, so they silently no-op when `RESEND_API_KEY` is unset. The daily digest is driven by the existing 60s publish/close sweep and made idempotent by a new persisted `Form.lastDigestSentAt` column, so a form gets at most one digest per ~24h regardless of tick rate. Submit-path emails are fire-and-forget with `.catch(console.error)`, so an email failure can never break a submission.

Watch for: nothing blocking. Owner-facing email bodies interpolate the owner-authored `formTitle` into HTML without escaping (possible), but this exactly matches the pre-existing `email.ts` templates the design told the coder to mirror, so it is consistent-with-existing, not a regression. The immediate-notify path does a per-submit `user.findUnique` for the owner email rather than selecting the owner alongside the form (possible, minor).

**Verdict**: APPROVED

## High-level view

The settings shape is threaded through all the places that must stay in lockstep: the Zod input schema, the API `FormSchema` type, the load-bearing `getFormSchema` allow-list (both keys defaulted — `"off"` / `false` — so existing forms behave exactly as before), the `updateFormSettings` conditional merge, and the web type + editor controls. The allow-list edit is the one that would silently drop values on every read if omitted; it is present and unconditional.

The two submit-path effects fire after the response row is saved, as independent fire-and-forget blocks placed alongside the existing analytics/milestone side-effect and before the quiz-score/return. Neither awaits into the request path, and both carry a `.catch`, so submission behavior and return value are unchanged whether email succeeds, fails, or no-ops.

The confirmation email is gated on `sendConfirmationEmail && collectEmail && normalizedEmail`, reusing the already-normalized email rather than re-deriving it. Answers are rendered through a defensive pure helper that tolerates arrays, booleans/yes-no, numbers, strings, and empties, and HTML-escapes every respondent-supplied value before it reaches the email body.

The daily digest sweep selects `PUBLISHED`/`CLOSED`, non-deleted, `daily`-mode forms whose `lastDigestSentAt` is null or older than 24h minus a 60s tolerance, counts responses in the window, sends only when count > 0, and stamps `lastDigestSentAt` after a successful send (at-least-once). It is wired into the one existing sweep timer, not a new one. The public form payload destructures both owner-only keys off `settings` before returning, so neither leaks to anonymous respondents.

<details>
<summary>Issues (2)</summary>

1. **Owner-authored title not HTML-escaped in email bodies** (possible) — `formTitle` is interpolated raw into the HTML of all three new builders. Owner-authored, and identical to the existing `email.ts` templates the design said to mirror, so not a regression. Optional hardening, not blocking.
2. **Per-submit owner lookup on immediate path** (possible) — immediate-notify does its own `user.findUnique` on every submission instead of selecting the owner email with the form row. Negligible at current scale; could fold the owner `select` into the initial `form` fetch later. Not blocking.

</details>

<details>
<summary>Details</summary>

### Settings shape threaded in lockstep

The five coupled sites all match the design. `updateFormSettingsSchema` gains `responseNotification: z.enum(["off","immediate","daily"]).optional()` and `sendConfirmationEmail: z.boolean().optional()`, so a PATCH omitting them leaves stored values untouched and a bad enum / non-boolean is rejected 400 by the existing route path. `UpdateFormSettingsInput` picks them up via `z.infer`. The API `FormSchema.settings` type and the web `FormSchema.settings` type both gain the two optional fields.

`getFormSchema` emits both keys unconditionally with concrete defaults — `responseNotification: candidate?.settings?.responseNotification ?? "off"` and `sendConfirmationEmail: candidate?.settings?.sendConfirmationEmail ?? false`. This is the load-bearing edit: the function re-emits only an allow-list, so a key not listed here is dropped on every read. Because both are always emitted, existing forms with neither key stored default to no-email behavior, and the `getPublicForm` destructure can reliably strip them. `updateFormSettings` merges both as conditional spreads alongside the existing ones.

### Submit-path effects are isolated and non-blocking

Both new blocks sit after `prisma.formResponse.create(...)` and the existing `void (async () => {...})().catch(...)` analytics/milestone block, and before the quiz-score computation and `return { ...response, quizScore }`. Each is its own `void (async () => {...})().catch((err) => console.error(...))`, so an email failure propagates nowhere — not into the request, not into the milestone logic, not into the return value. `sendEmail` already no-ops to console without `RESEND_API_KEY`, so the "no-op without Resend" requirement holds for free.

The immediate owner notification is gated on `schema.settings.responseNotification === "immediate"`, looks up the owner by `form.ownerId`, and bails if the owner has no email. The design's A.1 text specifies exactly this `user.findUnique({ where: { id: form.ownerId } })` lookup, so targeting the owner this way matches the spec. It does mean one extra `findUnique` per submission on the immediate path; `form` was fetched with no `select`, so the owner email could have been joined in up front — negligible at current scale, noted as possible future tidy-up, not a defect.

### Confirmation gating reuses the normalized email

The confirmation block requires `sendConfirmationEmail === true && collectEmail === true && normalizedEmail`, and passes `normalizedEmail` (the lowercased/trimmed value already computed for duplicate detection) as the recipient rather than re-deriving from `input.email`. This is the single authority for the "only when email collected" invariant, enforced at send time exactly as the design argued — the Zod layer deliberately does not cross-validate the two fields, and the UI disable is only a usability guard. A stored `sendConfirmationEmail: true` with `collectEmail: false` is harmless because this guard refuses to send.

### Defensive answer rendering

`buildConfirmationAnswerList(questions, answers)` is a pure module-level helper matching the `stripAnswerKeys` neighborhood. It omits `undefined`/`null`/`""`; joins non-empty array entries with `", "` and omits when all empty; normalizes `YES_NO` from both boolean and `"yes"`/`"no"` string shapes; stringifies numbers; passes strings through; handles bare booleans; and skips unknown shapes rather than risking awkward output. Every label and value is run through `escapeHtml` (covering `& < > " '`) before it can reach the HTML body, so respondent-supplied markup cannot break or inject into the email. Values arrive at `sendResponseConfirmationEmail` pre-escaped, and that builder only lays them out — the escaping responsibility sits in one place.

### Daily digest idempotency

`sendResponseDigests(now = new Date())` loads non-deleted `PUBLISHED`/`CLOSED` forms (selecting `id, title, ownerId, schema, lastDigestSentAt`), filters in application code to `responseNotification === "daily"` whose `lastDigestSentAt` is null or `<= now - (24h - 60s)`, counts responses in `(since, now]` where `since = lastDigestSentAt ?? now - 24h`, and only when count > 0 looks up the owner, sends, and stamps `lastDigestSentAt = now`.

```
sweep tick (every 60s)
  └─ sendResponseDigests(now)
       ├─ due = daily forms, lastDigestSentAt null OR <= now-(24h-60s)
       └─ per due form (try/catch, one failure won't abort sweep):
            count in (since, now]
            count==0 → skip, do NOT stamp  (window can't slide past un-notified)
            count>0  → send → stamp lastDigestSentAt=now  (at-least-once)
```

The anchor matches the design's Decision 1: a persisted column, a 60s tolerance, stamp-after-send ordering (a rare duplicate on a stamp-update failure beats silently dropping a digest), and no stamp on a zero-response window. The next tick ~60s later sees a fresh `lastDigestSentAt` and skips, so the per-form send rate is decoupled from the sweep cadence and survives process restarts. The migration `20260927000000_add_form_last_digest_sent_at/migration.sql` is the hand-authored `-- AlterTable` / `ALTER TABLE "Form" ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3);` form matching the cited precedent, the prefix sorts strictly after `20260926000100_add_form_share`, and `schema.prisma` adds `lastDigestSentAt DateTime?` to `Form`. No index, per the design.

The sweep is wired into `runPublishSweep()` in `server.ts` after the publish/close calls, inside the same try, with `sendResponseDigests` added to the existing `form.service.js` import — no new timer, which is the whole point of the persisted-stamp approach. `sendResponseDigests` stays in `form.service.ts` because it calls the module-private `getFormSchema`.

### Public payload strip

`getPublicForm` destructures `const { responseNotification, sendConfirmationEmail, ...publicSettings } = schema.settings`, `void`s both, and returns `settings: publicSettings`, mirroring the `stripAnswerKeys` destructure-and-`void` idiom. Both owner-only keys are removed from the anonymous payload; the remaining public settings (`collectEmail`, `allowMultipleResponses`, schedule fields, `quizMode`, `showScore`) are unchanged. Because `getFormSchema` always emits both keys, the destructure reliably catches them.

### Email builders

Three exported async builders are added to `email.ts` in the existing style, each assembling `{to, subject, html, text}` and calling the shared `sendEmail`, reusing `layout`/`button`/`getWebUrl`: `sendNewResponseNotificationEmail` and `sendResponseDigestEmail` link to `${webUrl}/forms/${formId}/responses`; `sendResponseConfirmationEmail` renders the pre-escaped answer list and links to `${webUrl}/f/${slug}`. None throw on their own; all inherit `sendEmail`'s silent console fallback and swallow-and-log. Owner-authored `formTitle` is interpolated into HTML without escaping — the same pattern as the pre-existing `sendFormShareExistingUserEmail`, which the design explicitly said to match, so this is consistent-with-existing rather than a new gap.

### Frontend controls

`FormEditorPage.tsx` adds both state hooks with correct defaults, loads both in `loadEditor` from `schema.settings?.…`, and includes both in the `/api/forms/:id/settings` PATCH body. The UI lives in the existing Collection `SettingsGroup`: a `<select>` bound to `responseNotification` (Off / Immediately / Daily digest) and a `settings-toggle` checkbox bound to `sendConfirmationEmail` with `disabled={!collectEmail}`, a 0.5 opacity when disabled, and a `<small>` that switches to "Turn on 'Collect email addresses' to enable." when collection is off. The checkbox still reflects the stored value while disabled. `toIsoInstant`/`toDatetimeLocal` and the schedule inputs are untouched. Settings round-trip through save (PATCH) and reload (`loadEditor`).

### Verification

The coder's `verification.md` records `prisma validate` and `prisma generate` PASS at repo root, `tsc --project tsconfig.json --noEmit` PASS in `apps/api`, and `tsc -b --noEmit` PASS in `apps/web`, against commit `8e0e89d`. Scope trigger (schema + migration) correctly flagged all three checks. No unit-test framework is wired in this repo (the api `test` script is a stub), consistent with the plan; typecheck + prisma validate is the project's real check. Evidence is present and sufficient — not re-run per instructions, and nothing in the diff leaves an articulable doubt warranting a spot-check.

</details>

<details>
<summary>File map</summary>

- `apps/api/src/modules/forms/form.schemas.ts` — two optional Zod fields on `updateFormSettingsSchema`.
- `apps/api/src/modules/forms/form.service.ts` — `FormSchema` type + `getFormSchema` defaults + `updateFormSettings` merge; public-payload strip; `escapeHtml` + `buildConfirmationAnswerList` helpers; two submit-path fire-and-forget email hooks; `sendResponseDigests` sweep.
- `apps/api/src/server.ts` — import and invoke `sendResponseDigests` in the existing sweep.
- `apps/api/src/services/email.ts` — three new email builders.
- `apps/web/src/pages/FormEditorPage.tsx` — state, load, PATCH, and two Collection-group controls.
- `apps/web/src/types/index.ts` — two optional settings fields.
- `prisma/schema.prisma` — `Form.lastDigestSentAt DateTime?`.
- `prisma/migrations/20260927000000_add_form_last_digest_sent_at/migration.sql` — raw-SQL ADD COLUMN.

Full diff: `git show 8e0e89d`.

</details>
