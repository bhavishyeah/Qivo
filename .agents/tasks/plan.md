# Implementation Plan — Qivo Pre-Deployment Bug-Fix Pass

Ordered, dependency-sequenced fixes from the audit (`.agents/tasks/audit-report.md`).
Monorepo at `c:\Qivo`: React+Vite web in `apps/web`, Express+Prisma API in `apps/api`.
Do NOT introduce unrelated changes. Each item leaves the codebase buildable.

## Verification commands (discovered during exploration)

- API typecheck: in `c:\Qivo\apps\api` run `pnpm exec tsc --project tsconfig.json --noEmit` — must exit 0.
- Web typecheck: in `c:\Qivo\apps\web` run `pnpm exec tsc -b --noEmit` — must exit 0.
  (NOTE: web `tsconfig.json` is a solution file with `"files": []` + references, so plain
  `tsc --project tsconfig.json --noEmit` typechecks nothing; build mode `-b` is required.
  Equivalent: `pnpm build`, which runs `tsc -b && vite build`.)
- Both baselines currently pass clean (verified before planning).

---

- [ ] 1. CRITICAL-1 — Fix scheduled publish/close datetime format mismatch (client-side boundary conversion).
      HTML `datetime-local` emits `YYYY-MM-DDTHH:mm` (no seconds/offset); the API Zod schema
      `z.string().datetime()` requires a full ISO instant, so saving any schedule 400s and breaks
      the entire settings save. Fix on the client only — do NOT touch the backend schema.
      In `apps/web/src/pages/FormEditorPage.tsx`:
      (a) Add two small helpers (module scope, near the top of the file): `toIsoInstant(local: string): string | null`
          → `if (!local) return null; const d = new Date(local); return Number.isNaN(d.getTime()) ? null : d.toISOString();`
          and `toDatetimeLocal(iso: string | null | undefined): string` →
          `if (!iso) return ""; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ""; return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);`
      (b) ON LOAD (~lines 143-144): replace
          `setScheduledPublishAt(schema.settings?.scheduledPublishAt ?? "");`
          `setScheduledCloseAt(schema.settings?.scheduledCloseAt ?? "");`
          with `setScheduledPublishAt(toDatetimeLocal(schema.settings?.scheduledPublishAt));`
          and `setScheduledCloseAt(toDatetimeLocal(schema.settings?.scheduledCloseAt));`
      (c) ON SAVE (~lines 585-586): replace
          `scheduledPublishAt: scheduledPublishAt || null,`
          `scheduledCloseAt: scheduledCloseAt || null,`
          with `scheduledPublishAt: toIsoInstant(scheduledPublishAt),`
          and `scheduledCloseAt: toIsoInstant(scheduledCloseAt),`
      Files: apps/web/src/pages/FormEditorPage.tsx
      Verify: `pnpm exec tsc -b --noEmit` in apps/web exits 0. Trace round trip: save sends a full
      ISO `...Z` string that `z.string().datetime()` accepts and that `publishDueForms` /
      `submitFormResponse` `new Date(scheduledAt)` parse; load reformats a stored ISO back to
      `YYYY-MM-DDTHH:mm` local for the input.

- [ ] 2. HIGH-1 — Mirror PublicFormPage NUMBER coercion in the preview renderer.
      In `apps/web/src/pages/FormPreviewPage.tsx` `handleInputChange` (~lines 47-51), replace the
      one-line `Number(event.target.value)` body with the exact logic from
      `apps/web/src/pages/PublicFormPage.tsx` (~lines 120-137): empty number input → `""`
      (unanswered); non-numeric → `""` (not NaN); otherwise the parsed number; non-number inputs
      pass the raw value through.
      Files: apps/web/src/pages/FormPreviewPage.tsx
      Verify: `pnpm exec tsc -b --noEmit` in apps/web exits 0.

- [ ] 3. HIGH-3 — Read the session cookie name from `env.SESSION_COOKIE_NAME` (single source of truth).
      `env.ts:20` already exposes `SESSION_COOKIE_NAME` with default `"qivo_session"` (confirmed).
      In `apps/api/src/middleware/auth.ts` replace `req.cookies?.qivo_session` with
      `req.cookies?.[env.SESSION_COOKIE_NAME]` and add `import { env } from "../config/env.js";`.
      In `apps/api/src/modules/auth/auth.routes.ts` replace the literal `"qivo_session"` in the
      logout `res.clearCookie(...)` and in each `res.cookie(...)` on signup/login/google with
      `env.SESSION_COOKIE_NAME`, adding `import { env } from "../../config/env.js";`.
      (This item must land together with item 4, which edits the same two files.)
      Files: apps/api/src/middleware/auth.ts, apps/api/src/modules/auth/auth.routes.ts
      Verify: `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api exits 0.

- [ ] 4. HIGH-2 — Remove dead cookie code; keep Bearer/localStorage auth (decision already made).
      Confirmed: `login`, `signup`, and `googleSignIn` all return `token: result.sessionToken`
      in the response body, so the browser never needs the cookie — removing it is safe. Logout
      already deletes the DB session, so dropping `clearCookie` is safe.
      In `apps/api/src/modules/auth/auth.routes.ts`: remove the three
      `res.cookie(env.SESSION_COOKIE_NAME, result.sessionToken, getSessionCookieOptions());`
      calls (signup/login/google) and the `res.clearCookie(env.SESSION_COOKIE_NAME, getClearCookieOptions());`
      in logout. Remove the now-unused import `{ getClearCookieOptions, getSessionCookieOptions }`
      from `../../config/cookie.js`. Leave `cookie-parser` and all CSRF/origin middleware untouched.
      In `apps/api/src/middleware/auth.ts`: keep the Bearer path primary; keep the cookie-read as a
      harmless fallback (now using `env.SESSION_COOKIE_NAME` from item 3) — do not remove it.
      Do NOT delete `apps/api/src/config/cookie.ts` (keep the file; it is simply no longer imported
      by auth.routes). If TS flags cookie.ts as unused elsewhere, leave it — it is a config module.
      Files: apps/api/src/modules/auth/auth.routes.ts, apps/api/src/middleware/auth.ts
      Verify: `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api exits 0. Confirm by
      reading the handlers that login/signup/google still return the token in the JSON body and
      logout still deletes the session — token delivery and clearing are unbroken.

- [ ] 5. MEDIUM-2 — Source session lifetime from `env.SESSION_DAYS` in both auth services.
      `env.ts` already parses `SESSION_DAYS` as a number with default 30 (confirmed).
      In `apps/api/src/modules/auth/auth.service.ts` remove `const SESSION_DAYS = 30;` and import
      `{ env } from "../../config/env.js"`, then use `env.SESSION_DAYS` in `createSessionExpiry()`.
      Do the same in `apps/api/src/modules/auth/google.service.ts`.
      Files: apps/api/src/modules/auth/auth.service.ts, apps/api/src/modules/auth/google.service.ts
      Verify: `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api exits 0.

- [ ] 6. MEDIUM-1 — Add `closeDueForms` sweep to flip PUBLISHED forms to CLOSED after schedule.
      `CLOSED` exists in the `FormStatus` enum (prisma/schema.prisma:28) and `closeForm` already
      sets `status: "CLOSED"` (confirmed). In `apps/api/src/modules/forms/form.service.ts` add a
      `closeDueForms(now: Date = new Date()): Promise<number>` mirroring `publishDueForms`: find
      `deletedAt: null, status: "PUBLISHED"` forms, filter to those whose
      `getFormSchema(f.schema).settings.scheduledCloseAt` is a valid date `<= now`, then
      `prisma.form.updateMany({ where: { id: { in: dueIds } }, data: { status: "CLOSED" } })`,
      returning `result.count`. Keep the per-request close check in `submitFormResponse` as a
      safety net. In `apps/api/src/server.ts` import `closeDueForms` and call it from the same
      sweep (extend `runPublishSweep` to also run `closeDueForms` and log closed count, OR add a
      parallel call in the same timer tick).
      Files: apps/api/src/modules/forms/form.service.ts, apps/api/src/server.ts
      Verify: `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api exits 0.

- [ ] 7. MEDIUM-3 — Event Registration template phone field → PHONE type.
      In `apps/api/src/modules/forms/templates.ts`, in the `event-registration` template change
      `{ label: "Phone Number", type: "SHORT_TEXT", required: true }` to `type: "PHONE"`.
      Files: apps/api/src/modules/forms/templates.ts
      Verify: `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api exits 0 (depends on item 8
      tightening the template type; done together).

- [ ] 8. MEDIUM-4 — Remove `q.type as any` in the /from-template handler (type-safe).
      Export the `QuestionType` union from `apps/api/src/modules/forms/form.service.ts`
      (add `export` to the existing `type QuestionType = ...`). In
      `apps/api/src/modules/forms/templates.ts` import `type { QuestionType }` from
      `./form.service.js` and type `TemplateQuestion.type` as `QuestionType` (instead of `string`).
      In `apps/api/src/modules/forms/form.routes.ts` /from-template handler, drop the `as any`
      so it reads `type: q.type,`. Now template question types are checked against the union at
      compile time. (All current templates use valid types, so this compiles once item 7's `PHONE`
      is in place.)
      Files: apps/api/src/modules/forms/form.service.ts, apps/api/src/modules/forms/templates.ts, apps/api/src/modules/forms/form.routes.ts
      Verify: `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api exits 0.

- [ ] 9. Full verification pass.
      (a) `pnpm exec tsc --project tsconfig.json --noEmit` in apps/api → exit 0.
      (b) `pnpm exec tsc -b --noEmit` in apps/web → exit 0.
      (c) CRITICAL-1 round trip re-traced: datetime-local → ISO on save → stored → ISO → datetime-local on load.
      (d) HIGH-2: login/signup/google return token in body; logout deletes session + no cookie dependency.
      No unrelated changes introduced.
