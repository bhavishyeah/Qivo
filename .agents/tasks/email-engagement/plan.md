# Implementation Plan — Email engagement features (Qivo)

Source of truth: the APPROVED design at `c:\Qivo\.agents\tasks\email-engagement\design.md` (review `design-review.md`). Every item below is grounded in the actual code read during exploration. Order is dependency-driven: Prisma field first (so the service can read `lastDigestSentAt` and `tsc` passes), then shared settings shape (schema → service type/default/merge → public strip), then email builders, then the two submit-path hooks, then the digest sweep + server wiring, then the frontend.

Project facts discovered during exploration (use these exact commands; there is no AGENTS.md, no `.kiro/steering`, and no unit-test framework wired up — the api `test` script is a stub, so verification is typecheck + prisma validate):

- API typecheck: `pnpm exec tsc --noEmit` run in `c:\Qivo\apps\api` (or `pnpm typecheck` at repo root, which runs API then web).
- Web typecheck/build: `pnpm exec tsc -b` run in `c:\Qivo\apps\web` (matches the web `build` script `tsc -b && vite build`).
- Prisma: schema + migrations live ONLY at repo root `c:\Qivo\prisma\`; generator output is `apps/api/src/generated/prisma`. After a schema edit run `pnpm exec prisma generate` and `pnpm exec prisma validate` at repo root. Do NOT run `prisma migrate deploy` / `pnpm db:migrate` against the shared/production DB during verification.
- Migration SQL convention (verified against `20260822082301_add_workspace_branding/migration.sql`): `-- AlterTable` comment then `ALTER TABLE "Form" ADD COLUMN     "col" TYPE;` with the double space after `ADD COLUMN` (cosmetic to Postgres, matches Prisma's generated style). Highest existing prefix is `20260926000100_add_form_share`; the new `20260927000000_...` sorts strictly after it.

---

- [ ] 1. Add the `lastDigestSentAt` column to the Prisma `Form` model and a hand-authored migration.
      In `c:\Qivo\prisma\schema.prisma`, `Form` model, add a scalar field `lastDigestSentAt DateTime?` after `deletedAt DateTime?` (before the relation block). Create the migration folder+file `c:\Qivo\prisma\migrations\20260927000000_add_form_last_digest_sent_at\migration.sql` containing exactly:
      ```sql
      -- AlterTable
      ALTER TABLE "Form" ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3);
      ```
      Do NOT add an index (the design decided none is needed). Do NOT run `migrate deploy` against a shared DB.
      Files: `c:\Qivo\prisma\schema.prisma`, `c:\Qivo\prisma\migrations\20260927000000_add_form_last_digest_sent_at\migration.sql`
      Verify: at repo root run `pnpm exec prisma validate` (schema is valid) and `pnpm exec prisma generate` (client regenerates into `apps/api/src/generated/prisma` with `lastDigestSentAt` on the Form type). Both succeed.

- [ ] 2. Extend the settings Zod schema with the two new optional inputs.
      In `c:\Qivo\apps\api\src\modules\forms\form.schemas.ts`, `updateFormSettingsSchema` (the `z.object({...})`), add `responseNotification: z.enum(["off", "immediate", "daily"]).optional(),` and `sendConfirmationEmail: z.boolean().optional(),`. Keep the existing `collectEmail`/`allowMultipleResponses`/`confirmationMessage` fields REQUIRED (do not loosen them). `UpdateFormSettingsInput` (the `z.infer`) picks the new fields up automatically.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.schemas.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 3. Extend the API `FormSchema.settings` type, default both keys in `getFormSchema`, and merge both in `updateFormSettings`.
      In `c:\Qivo\apps\api\src\modules\forms\form.service.ts`:
      (a) In the `FormSchema` type's `settings` object (after `showScore?: boolean;`), add `responseNotification?: "off" | "immediate" | "daily";` and `sendConfirmationEmail?: boolean;`.
      (b) In `getFormSchema()`'s returned `settings` (this is a LOAD-BEARING allow-list — keys not emitted here are dropped on every read), add unconditionally: `responseNotification: candidate?.settings?.responseNotification ?? "off",` and `sendConfirmationEmail: candidate?.settings?.sendConfirmationEmail ?? false,`.
      (c) In `updateFormSettings()`'s merged `settings` object, add two conditional spreads alongside the existing ones: `...(input.responseNotification !== undefined ? { responseNotification: input.responseNotification } : {}),` and `...(input.sendConfirmationEmail !== undefined ? { sendConfirmationEmail: input.sendConfirmationEmail } : {}),`.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.service.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 4. Strip the two owner-only keys from the public form payload.
      In `c:\Qivo\apps\api\src\modules\forms\form.service.ts`, `getPublicForm()`, where the return currently sets `settings: schema.settings,`: before the return build `const { responseNotification, sendConfirmationEmail, ...publicSettings } = schema.settings; void responseNotification; void sendConfirmationEmail;` (mirrors the existing `stripAnswerKeys` destructure-and-`void` pattern) and change the returned field to `settings: publicSettings,`. Because step 3 makes `getFormSchema` always emit both keys, the destructure reliably removes them.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.service.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 5. Add the three email builder functions to the email service.
      In `c:\Qivo\apps\api\src\services\email.ts`, after the existing form-share templates, add three exported async functions in the existing style (each builds `{to, subject, html, text}` and calls the shared `sendEmail`, reusing `layout`, `button`, `getWebUrl`; none throw — `sendEmail` already no-ops without `RESEND_API_KEY`):
      - `sendNewResponseNotificationEmail(to: string, opts: { formTitle: string; formId: string }): Promise<void>` — subject `New response to "<formTitle>"`; body one-liner + `button(`${webUrl}/forms/${opts.formId}/responses`, "View responses")`.
      - `sendResponseDigestEmail(to: string, opts: { formTitle: string; formId: string; count: number }): Promise<void>` — subject like `<count> new response(s) to "<formTitle>"`; body mentions `opts.count` responses in the last 24 hours + the same responses-page button.
      - `sendResponseConfirmationEmail(to: string, opts: { formTitle: string; formId: string; slug: string; answers: Array<{ label: string; value: string }> }): Promise<void>` — subject `Thanks for your response to "<formTitle>"`; body a thank-you line, the optional `answers` list laid out as `label: value` rows (values arrive pre-sanitized/pre-escaped from step 7; this function only lays them out), and `button(`${webUrl}/f/${opts.slug}`, "Open form")`.
      Files: `c:\Qivo\apps\api\src\services\email.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 6. Add the defensive answer-rendering helper used to build the confirmation email's answer list.
      In `c:\Qivo\apps\api\src\modules\forms\form.service.ts`, add a small pure module-level helper (near `stripAnswerKeys`) that takes the form's questions (`schema.sections.flatMap(s => s.questions)`) and the submitted `answers` record and returns `Array<{ label: string; value: string }>`. Rendering rules from the design (never throw; omit awkward fields): omit when value is `undefined`/`null`/`""`; arrays (`MULTI_ENTRY`, and `MULTIPLE_CHOICE` which may arrive as a bare string per `validateAnswerAgainstQuestion`) → `Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v)`, omit if empty; file URL (`^https?://`) → the URL string; `YES_NO` → `value === true || value === "yes"` → "Yes", `value === false || value === "no"` → "No"; number → `String(value)`; plain string → the string. HTML-escape every respondent-supplied value here so the email HTML cannot be broken/injected. Match answers to questions by `question.id`; label is `question.label`.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.service.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 7. Add the immediate-owner-notification and respondent-confirmation fire-and-forget hooks to `submitFormResponse`.
      In `c:\Qivo\apps\api\src\modules\forms\form.service.ts`, `submitFormResponse()`, in the post-create region — AFTER the `prisma.formResponse.create(...)` row is saved and alongside the existing `void (async () => { ... })().catch(...)` analytics/milestone block, and BEFORE the quiz-score block / `return { ...response, quizScore }` — add two independent fire-and-forget blocks:
      (a) Immediate owner notify: `if (schema.settings.responseNotification === "immediate") { void (async () => { const owner = await prisma.user.findUnique({ where: { id: form.ownerId }, select: { email: true, name: true } }); if (!owner?.email) return; await sendNewResponseNotificationEmail(owner.email, { formTitle: form.title, formId: form.id }); })().catch((err) => console.error("response notification email failed:", err)); }`
      (b) Respondent confirmation: guard on `schema.settings.sendConfirmationEmail === true && schema.settings.collectEmail === true && normalizedEmail` (reuse the already-computed `normalizedEmail`, do not re-derive from `input.email`). Inside, build the answers via the step-6 helper and `await sendResponseConfirmationEmail(normalizedEmail, { formTitle: form.title, formId: form.id, slug: form.slug, answers })`; wrap in `void (async () => { ... })().catch((err) => console.error("confirmation email failed:", err));`.
      Add the imports of `sendNewResponseNotificationEmail` and `sendResponseConfirmationEmail` from `../../services/email.js`. Neither block awaits into the request path, so submission behavior/return value is unchanged.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.service.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 8. Add the exported `sendResponseDigests(now)` sweep function.
      In `c:\Qivo\apps\api\src\modules\forms\form.service.ts`, add (near `publishDueForms`/`closeDueForms`, and it MUST stay in this module because it calls the private `getFormSchema`):
      ```ts
      export async function sendResponseDigests(now: Date = new Date()): Promise<number>
      ```
      Algorithm per the design: `const DIGEST_INTERVAL_MS = 24*60*60*1000; const DIGEST_TOLERANCE_MS = 60_000;`. Load candidates `prisma.form.findMany({ where: { deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } }, select: { id: true, title: true, ownerId: true, schema: true, lastDigestSentAt: true } })`. Keep forms where `getFormSchema(f.schema).settings.responseNotification === "daily"` AND (`f.lastDigestSentAt == null` OR `f.lastDigestSentAt.getTime() <= now.getTime() - (DIGEST_INTERVAL_MS - DIGEST_TOLERANCE_MS)`). For each due form (wrap each in try/catch so one failure doesn't abort the sweep): `since = f.lastDigestSentAt ?? new Date(now.getTime() - DIGEST_INTERVAL_MS)`; `count = await prisma.formResponse.count({ where: { formId: f.id, submittedAt: { gt: since, lte: now } } })`; if `count > 0` look up owner (`findUnique` email/name; skip if no email), `await sendResponseDigestEmail(owner.email, { formTitle: f.title, formId: f.id, count })`, then `await prisma.form.update({ where: { id: f.id }, data: { lastDigestSentAt: now } })`, and increment a counter. If `count === 0`, do NOT send and do NOT stamp. Return the sent count. Import `sendResponseDigestEmail` from `../../services/email.js`.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.service.ts`
      Verify: API `pnpm exec tsc --noEmit` passes (relies on `lastDigestSentAt` from step 1's generated client).

- [ ] 9. Wire `sendResponseDigests` into the existing sweep timer.
      In `c:\Qivo\apps\api\src\server.ts`, add `sendResponseDigests` to the existing import from `./modules/forms/form.service.js` (next to `publishDueForms, closeDueForms`). Inside `runPublishSweep()`, after the close call and before the `catch`, add `const digests = await sendResponseDigests(); if (digests > 0) console.log(\`[scheduler] sent ${digests} response digest(s)\`);`. Do not add a new timer — reuse the single existing `PUBLISH_SWEEP_MS` sweep (idempotency comes from `lastDigestSentAt`, not the tick rate).
      Files: `c:\Qivo\apps\api\src\server.ts`
      Verify: API `pnpm exec tsc --noEmit` passes.

- [ ] 10. Extend the web-side settings type with the two optional fields.
      In `c:\Qivo\apps\web\src\types\index.ts`, `FormSchema.settings` object (after `showScore?: boolean;`), add `responseNotification?: "off" | "immediate" | "daily";` and `sendConfirmationEmail?: boolean;` so the editor's reads typecheck.
      Files: `c:\Qivo\apps\web\src\types\index.ts`
      Verify: web `pnpm exec tsc -b` passes.

- [ ] 11. Add the two settings controls, state, load, and PATCH payload in the form editor.
      In `c:\Qivo\apps\web\src\pages\FormEditorPage.tsx`:
      (a) State (in the `// Settings` block, next to `collectEmail` etc.): `const [responseNotification, setResponseNotification] = useState<"off" | "immediate" | "daily">("off");` and `const [sendConfirmationEmail, setSendConfirmationEmail] = useState(false);`.
      (b) Load (in `loadEditor`, next to the other `setX(schema.settings?....)` calls): `setResponseNotification(schema.settings?.responseNotification ?? "off");` and `setSendConfirmationEmail(schema.settings?.sendConfirmationEmail ?? false);`.
      (c) Save (in `saveFormSettings`, inside the `api.patch("/api/forms/${formId}/settings", {...})` body): add `responseNotification,` and `sendConfirmationEmail,`.
      (d) UI: inside the existing Collection `SettingsGroup` (the `title="Collection"` group), add a `<select>` bound to `responseNotification` with options Off / Immediately (`immediate`) / Daily digest (`daily`) using the existing `question-field` label/select styling, and a `settings-toggle` checkbox bound to `sendConfirmationEmail` structured like the `collectEmail` toggle, with `disabled={!collectEmail}` and a muted `<small>` hint such as "Turn on 'Collect email addresses' to enable." Do NOT touch `toIsoInstant`/`toDatetimeLocal` or the datetime-local schedule inputs in the Access & Schedule group.
      Files: `c:\Qivo\apps\web\src\pages\FormEditorPage.tsx`
      Verify: web `pnpm exec tsc -b` passes.

- [ ] 12. Full typecheck of both apps and Prisma consistency.
      Run the project's real build/typecheck commands end to end to confirm the whole change compiles and the schema is consistent.
      Files: (none — verification only)
      Verify: repo root `pnpm typecheck` (API `tsc --noEmit` then web `tsc --noEmit`) passes; `pnpm exec prisma validate` and `pnpm exec prisma generate` succeed; `pnpm exec vite build` in `apps/web` succeeds. Do NOT run `prisma migrate deploy` against a shared/production DB.

---

## Notes / assumptions

- No unit-test framework is configured (the api `test` script is a stub and there is no vitest/jest in either `package.json`). Per the design's testability section the logic is structured to be unit-testable (pure helpers, injectable `now`), but adding a test runner is out of scope for this task; verification therefore relies on `tsc` typecheck + `prisma validate`/`generate` + `vite build`, which are the project's real, runnable checks. If the implement/review loop wants regression coverage, the two pure helpers (the step-6 answer renderer and the step-8 due-selection/window math with injected `now`) are the natural first unit tests.
- Decomposition decision: this task is a single tightly-threaded vertical (settings shape must change in lockstep across schema → service type/default/merge → public strip → web type → editor; the submit hooks depend on the email builders and the answer-render helper; the digest sweep depends on the migration-backed `lastDigestSentAt`, the email builder, and the server wiring). The design review APPROVED it as one coherent change. It does not split into genuinely separable features, so this is written as one ordered plan for the existing implement-and-review loop rather than decomposed into FEAT artifacts.
