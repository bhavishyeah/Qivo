# Implementation Plan — Per-Form Sharing + Email Invites (FormShare)

Source of truth: `c:\Qivo\.agents\tasks\form-share-feature\design.md` (approved) and
`c:\Qivo\.agents\tasks\form-share-feature\design-review.md` (APPROVED). This plan sequences
that design faithfully; it does not re-decide architecture.

## Project facts discovered during exploration

- Monorepo (pnpm). API: `c:\Qivo\apps\api` (Express 5, TypeScript ESM with `.js` import
  specifiers, Prisma 7 client generated to `apps/api/src/generated/prisma`). Web:
  `c:\Qivo\apps\web` (React 19 + React Router 7 + Vite).
- **No runtime test framework exists.** `apps/api` `test` script is a stub
  (`echo ... && exit 1`); `apps/web` has eslint only. Verification therefore relies on the
  TypeScript compiler and the build, plus eslint for the web app. Do NOT invent a test runner;
  use the commands below.
- Real commands (run from repo root `c:\Qivo`):
  - Typecheck both apps: `pnpm typecheck` (runs `tsc --noEmit` in api then web).
  - API build: `pnpm build:api`. Web build: `pnpm build:web`.
  - Prisma client generate: `pnpm db:generate`. Apply migrations: `pnpm db:migrate`
    (`prisma migrate deploy`).
  - Web lint: `pnpm lint`.
- Migration convention: hand-authored timestamped folders under
  `c:\Qivo\prisma\migrations\<ts>_<name>\migration.sql` (raw SQL). Latest existing folder is
  `20260925000000_add_google_id_and_respondent_email`.
- Token style in `auth.service.ts`: `randomBytes(32).toString("hex")` — reuse for share token.
- Error signalling: throw `Error` with `.name` = code; `app.ts` `errorHandler` maps `.name` →
  HTTP status. Only `SHARE_NOT_FOUND` is new.

---

- [ ] 1. Add FormShare data model + enums + notification type to the Prisma schema, write the two
      migration folders, and regenerate the client.
      In `c:\Qivo\prisma\schema.prisma`: add `enum FormShareRole { RESPONDER EDITOR VIEWER }`,
      `enum FormShareStatus { PENDING ACCEPTED }`, the `FormShare` model (exact fields/indexes
      from design: `@@unique([formId, email])`, unique `token`, `@@index([formId])`,
      `@@index([userId])`; FKs `form` Cascade, `user` SetNull named `FormShareUser`, `invitedBy`
      Restrict named `FormShareInviter`); add back-references `shares FormShare[]` on `Form`,
      `formShares FormShare[] @relation("FormShareUser")` + `formSharesInvited FormShare[]
      @relation("FormShareInviter")` on `User`; add `FORM_SHARED` to `enum NotificationType`.
      Create `c:\Qivo\prisma\migrations\20260926000000_add_form_shared_notification_type\migration.sql`
      with ONLY `ALTER TYPE "NotificationType" ADD VALUE 'FORM_SHARED';` (standalone — see design
      rationale). Create `c:\Qivo\prisma\migrations\20260926000100_add_form_share\migration.sql`
      with the `CREATE TYPE` for both enums, `CREATE TABLE "FormShare"`, the four indexes
      (`FormShare_token_key` unique, `FormShare_formId_email_key` unique, `FormShare_formId_idx`,
      `FormShare_userId_idx` — NO `FormShare_token_idx`), and the three FK constraints, exactly as
      in the design's Migration 2 SQL block. Then run `pnpm db:generate`.
      Files: `c:\Qivo\prisma\schema.prisma`,
      `c:\Qivo\prisma\migrations\20260926000000_add_form_shared_notification_type\migration.sql`,
      `c:\Qivo\prisma\migrations\20260926000100_add_form_share\migration.sql`
      Verify: `pnpm db:generate` succeeds and emits no schema errors; `pnpm --filter api exec
      prisma validate` passes. Confirm the generated client exports `FormShare`, `FormShareRole`,
      `FormShareStatus`, and `FORM_SHARED` (e.g. grep the generated enums file).

- [ ] 2. Create the access-helper module with the three share-capability queries.
      New file `c:\Qivo\apps\api\src\modules\formShares\formShare.access.ts` exporting
      `getAcceptedShareRole(formId, userId)`, `hasEditorShare(formId, userId)`,
      `hasResponseViewShare(formId, userId)` exactly per the design (all filter
      `status: "ACCEPTED"`; EDITOR-only / EDITOR-or-VIEWER filters respectively; RESPONDER never
      grants edit or response-view). Uses the `prisma` singleton from
      `c:\Qivo\apps\api\src\db\prisma.js`.
      Files: `c:\Qivo\apps\api\src\modules\formShares\formShare.access.ts`
      Verify: `pnpm typecheck` passes (the file compiles against the regenerated client from step 1).

- [ ] 3. Create the formShares schemas and service.
      `formShare.schemas.ts`: `createShareSchema = z.object({ email: z.string().trim().email()
      .max(200), role: z.enum(["RESPONDER","EDITOR","VIEWER"]) })`.
      `formShare.service.ts`: implement `requireFormEditor`, `listShares`, `createShare`,
      `revokeShare`, `getInviteByToken`, `acceptInvite`, `listSharedWithMe` exactly per the design
      (explicit `findUnique({ where: { formId_email: { formId, email } } })` read-then-create/update
      — NOT `upsert`; token preserved on re-invite; token via `randomBytes(32).toString("hex")`;
      email always lowercased; side effects fired as `void <promise>.catch(console.error)`; pinned
      notification `title`/`message` literals; email-match check in `acceptInvite`;
      `SHARE_NOT_FOUND` error helper). Import email functions (step 5) and `createNotification`.
      Files: `c:\Qivo\apps\api\src\modules\formShares\formShare.schemas.ts`,
      `c:\Qivo\apps\api\src\modules\formShares\formShare.service.ts`
      Verify: `pnpm typecheck` passes. (Note: steps 3 and 5 are mutually dependent via imports;
      implement 5's signatures first or stub, then this; the feature-level build in the FEAT plan
      covers both together.)

- [ ] 4. Create the two routers.
      `formShare.routes.ts` (default export `formShareRouter`, all `requireAuth`): `GET
      /shared-with-me` declared FIRST, then `POST /:formId/shares`, `GET /:formId/shares`, `DELETE
      /:formId/shares/:shareId`. `invite.routes.ts` (default export `inviteRouter`): `GET /:token`
      (public, no `requireAuth`), `POST /:token/accept` (`requireAuth`). Each handler follows the
      members/forms handler shape (401 guard, param string checks, `schema.parse(req.body)`,
      `{ success: true, data: {...} }`, `catch (error) { next(error); }`).
      Files: `c:\Qivo\apps\api\src\modules\formShares\formShare.routes.ts`,
      `c:\Qivo\apps\api\src\modules\formShares\invite.routes.ts`
      Verify: `pnpm typecheck` passes.

- [ ] 5. Add the two email functions.
      In `c:\Qivo\apps\api\src\services\email.ts` add `sendFormShareInviteEmail(to, opts)` and
      `sendFormShareExistingUserEmail(to, opts)` matching `sendTeamInviteEmail` style (`layout` +
      `button` + `await sendEmail(...)`), with role-dependent links via `getWebUrl()` and a local
      `roleLabel`/`roleVerb` map, per the design's Email section. No env changes required
      (`RESEND_API_KEY`/`EMAIL_FROM`/`WEB_URL` reused; `sendEmail` already no-ops silently).
      Files: `c:\Qivo\apps\api\src\services\email.ts`
      Verify: `pnpm typecheck` passes.

- [ ] 6. Wire notifications.
      In `c:\Qivo\apps\api\src\modules\notifications\notification.service.ts` add `FORM_SHARED` to
      the local `NotificationType` union and add a `FORM_SHARED` entry to BOTH the `messages`
      (`"A form was shared with you."`) and `titles` (`"Form shared with you"`) maps in
      `notifyFormEvent` so the `Record<NotificationType, string>` typing stays exhaustive.
      Files: `c:\Qivo\apps\api\src\modules\notifications\notification.service.ts`
      Verify: `pnpm typecheck` passes.

- [ ] 7. Integrate per-form share access into form.service.ts without weakening workspace checks.
      In `c:\Qivo\apps\api\src\modules\forms\form.service.ts`, import the access helpers and add the
      OR-fallback to `getEditableForm`, `getForm` (gated to `hasResponseViewShare` only — RESPONDER
      must NOT load the editor read), `getFormForResponseAccess` (`hasResponseViewShare`), and
      restructure `updateForm` to the single non-VIEWER-member query + `hasEditorShare` fallback
      that runs whenever the workspace path yields no form (covering both non-member and
      VIEWER-member cases). Leave `deleteForm`/`publishForm` workspace-only. Keep existing export
      visibility unchanged. All exactly per the design's "Effective access resolution" section.
      Files: `c:\Qivo\apps\api\src\modules\forms\form.service.ts`
      Verify: `pnpm typecheck` passes.

- [ ] 8. Register routers and the new error code in app.ts.
      In `c:\Qivo\apps\api\src\app.ts`: import `formShareRouter` and `inviteRouter`; add
      `app.use("/api/forms", formShareRouter);` BEFORE `app.use("/api/forms", formRouter);` so
      `/api/forms/shared-with-me` resolves before `/:formId`; add `app.use("/api/invites",
      inviteRouter);`; add a `case "SHARE_NOT_FOUND":` → 404 branch to `errorHandler`.
      Files: `c:\Qivo\apps\api\src\app.ts`
      Verify: `pnpm typecheck` passes and `pnpm build:api` compiles.

- [ ] 9. Add frontend types.
      In `c:\Qivo\apps\web\src\types\index.ts` add `FormShareRole`, `FormShareStatus`, `FormShare`,
      `SharedWithMeItem`, `InvitePreview` exactly as in the design's Types block.
      Files: `c:\Qivo\apps\web\src\types\index.ts`
      Verify: `pnpm --filter web exec tsc --noEmit` passes.

- [ ] 10. Extend FormSharePage with the invite card + shares list + revoke.
      In `c:\Qivo\apps\web\src\pages\FormSharePage.tsx` add the state, the shares fetch in the
      existing `loadForm` effect, `handleSendInvite`/`handleRevoke`, and the new card UI (role
      select with descriptions, shares list rows with role/status pills and revoke), mirroring
      `TeamPage.tsx`'s invite UX and reusing existing CSS classes. A 403 on list is surfaced as a
      benign note, not a page break.
      Files: `c:\Qivo\apps\web\src\pages\FormSharePage.tsx`
      Verify: `pnpm --filter web exec tsc --noEmit` and `pnpm lint` pass.

- [ ] 11. Add the AcceptInvitePage and its route; wire GuestOnly + AuthGuard token carry.
      Create `c:\Qivo\apps\web\src\pages\AcceptInvitePage.tsx` (read `token`; `publicGet` the
      preview; Accept via `api.post`; role-based redirect; error branches via `ApiRequestError.code`)
      per the design. In `c:\Qivo\apps\web\src\App.tsx` import it and add
      `<Route path="/accept-invite" element={<Protected>{() => <AcceptInvitePage />}</Protected>} />`,
      and update `GuestOnly` to add `useLocation` and redirect a logged-in user with `?invite=` to
      `/accept-invite?token=...`. In `c:\Qivo\apps\web\src\components\AuthGuard.tsx` special-case the
      no-user redirect so `/accept-invite?token=T` → `/login?invite=T` (drop the dead `state.from`).
      Files: `c:\Qivo\apps\web\src\pages\AcceptInvitePage.tsx`, `c:\Qivo\apps\web\src\App.tsx`,
      `c:\Qivo\apps\web\src\components\AuthGuard.tsx`
      Verify: `pnpm --filter web exec tsc --noEmit` and `pnpm lint` pass.

- [ ] 12. Carry the invite token through Signup and Login.
      In `c:\Qivo\apps\web\src\pages\SignupPage.tsx` and `c:\Qivo\apps\web\src\pages\LoginPage.tsx`
      change the router import to include `useLocation`, read `inviteToken` once at component scope
      from `location.search`, and after `setToken(...)` navigate to
      `/accept-invite?token=<encoded>` when present else `/dashboard` — in BOTH `handleSubmit` and
      (LoginPage) `handleGoogleCallback`. Carry the token on each page's cross-link
      (login↔signup). Per design + review NITs #1/#2.
      Files: `c:\Qivo\apps\web\src\pages\SignupPage.tsx`, `c:\Qivo\apps\web\src\pages\LoginPage.tsx`
      Verify: `pnpm --filter web exec tsc --noEmit` and `pnpm lint` pass.

- [ ] 13. Document env reuse.
      In `c:\Qivo\.env.example` add a comment noting `RESEND_API_KEY` / `EMAIL_FROM` / `WEB_URL`
      are reused for form-share invites (behavior identical to password reset).
      Files: `c:\Qivo\.env.example`
      Verify: `pnpm typecheck` and `pnpm build:api` and `pnpm build:web` all pass (final
      whole-project compile).

## Notes / assumptions

- No automated test suite exists; verification is compiler + build + lint. If the implementing
  agent adds a test runner it must be the standard choice (vitest) and must not block the build.
- `.env.example` path assumed at repo root (`c:\Qivo\.env.example`); if it does not exist, create it
  or adjust to the existing example file location — this is the only non-load-bearing step.
