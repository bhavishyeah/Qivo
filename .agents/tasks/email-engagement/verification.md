# Verification — Email engagement features

Date: 2026-10-27
Iteration: FIRST (no review.json present at start)

## Commands run and results

All commands run on Windows / PowerShell.

| Command | CWD | Result |
|---|---|---|
| `pnpm exec prisma validate` | `c:\Qivo` | OK — "The schema at prisma\schema.prisma is valid 🚀" (exit 0) |
| `pnpm exec prisma generate` | `c:\Qivo` | OK — Generated Prisma Client (7.9.1) to `.\apps\api\src\generated\prisma` (exit 0). `lastDigestSentAt` now on the Form type. |
| `pnpm exec tsc --project tsconfig.json --noEmit` | `c:\Qivo\apps\api` | exit 0 (no type errors) |
| `pnpm exec tsc --noEmit` | `c:\Qivo\apps\api` | exit 0 (no type errors) |
| `pnpm exec tsc -b --noEmit` | `c:\Qivo\apps\web` | exit 0 (no type errors) |
| `pnpm exec tsc -b` | `c:\Qivo\apps\web` | exit 0 (no type errors) |

No `prisma migrate deploy` / `pnpm db:migrate` was run — per the design/plan this must NOT be run against the shared/production DB. Migration SQL consistency was confirmed via `prisma validate` + `prisma generate` only.

## Notes

- No unit-test framework is wired up in the repo (the api `test` script is a stub; no vitest/jest). Verification is therefore the project's real checks: typecheck + prisma validate/generate, exactly as the plan specifies.
- Migration added: `prisma/migrations/20260927000000_add_form_last_digest_sent_at/migration.sql` (adds nullable `Form."lastDigestSentAt" TIMESTAMP(3)`), matching the existing `-- AlterTable` + double-space `ADD COLUMN` convention from `20260822082301_add_workspace_branding`.
- Digest idempotency decision (design Decision 1, implemented): persisted `Form.lastDigestSentAt` timestamp. A `daily` form is "due" only when `lastDigestSentAt` is null or `<= now − (24h − 60s tolerance)`. On a due form, responses in `(since, now]` are counted; if `count > 0` the owner is emailed and `lastDigestSentAt` is stamped to `now`. If `count === 0`, no send and no stamp (window does not slide past un-notified responses). Stamp-after-send ordering = at-least-once (a rare duplicate is safer than a silent drop). This makes the per-form send rate independent of the 60s sweep cadence and survives process restarts.
- Owner-only settings (`responseNotification`, `sendConfirmationEmail`) are stripped from the public form payload in `getPublicForm()` via destructure-and-`void`, mirroring `stripAnswerKeys`.

## Per-feature files/functions changed

Feature A — owner response notification (`responseNotification`: off|immediate|daily):
- `prisma/schema.prisma` — `Form.lastDigestSentAt DateTime?`
- `prisma/migrations/20260927000000_add_form_last_digest_sent_at/migration.sql`
- `apps/api/src/modules/forms/form.schemas.ts` — `responseNotification` enum in `updateFormSettingsSchema`
- `apps/api/src/modules/forms/form.service.ts` — `FormSchema` type; `getFormSchema` default `"off"`; `updateFormSettings` merge; immediate fire-and-forget block in `submitFormResponse`; new `sendResponseDigests(now)`; public-payload strip in `getPublicForm`
- `apps/api/src/services/email.ts` — `sendNewResponseNotificationEmail`, `sendResponseDigestEmail`
- `apps/api/src/server.ts` — import + `sendResponseDigests()` wired into `runPublishSweep`

Feature B — respondent confirmation email (`sendConfirmationEmail`):
- `apps/api/src/modules/forms/form.schemas.ts` — `sendConfirmationEmail` boolean
- `apps/api/src/modules/forms/form.service.ts` — `FormSchema` type; `getFormSchema` default `false`; `updateFormSettings` merge; `escapeHtml` + `buildConfirmationAnswerList` helpers; guarded fire-and-forget block in `submitFormResponse`
- `apps/api/src/services/email.ts` — `sendResponseConfirmationEmail`

Frontend (both features):
- `apps/web/src/types/index.ts` — two optional fields on `FormSchema.settings`
- `apps/web/src/pages/FormEditorPage.tsx` — state, load, PATCH payload, and two controls (select + disabled-when-no-collectEmail checkbox) in the Collection group. Datetime-local <-> ISO helpers untouched.
