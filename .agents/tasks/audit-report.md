# Qivo Pre-Deployment Audit Report

Read-only audit of the Qivo form-builder monorepo (`c:\Qivo`) ahead of a fresh Railway deployment.
No code was modified. Scope: `apps/api` (Express + Prisma) and `apps/web` (React + Vite), plus Prisma schema, env, and deploy config.

---

## 1. Executive summary

Overall the codebase is in good shape and largely production-ready. Both type checks pass clean:

- `apps/api`: `pnpm exec tsc --noEmit` → exit 0, no errors.
- `apps/web`: `pnpm exec tsc --noEmit` → exit 0, no errors.

The recently added **MULTI_ENTRY** question type is correctly and completely wired across every layer (shared type, Zod enum, service-local union, service validation, required-check, editor UI, public renderer, preview renderer, reports aggregation, response dashboard, CSV/Excel export). The report-aggregation refinement that the prior review flagged (flattening the array instead of `String(["a","b"])`) has been applied in `getFormReport`. See the lifecycle matrix in §6 — no gaps found for MULTI_ENTRY.

Authentication, authorization (VIEWER/EDITOR/ADMIN/OWNER), CSRF (origin-based, public submit correctly exempt), CORS (multi-origin WEB_URL with credentials), rate limiting (public forms get a separate higher bucket), the duplicate-response DB unique constraint + race handling, quiz answer-key stripping on the public payload, and Google OAuth email-verification checks are all implemented soundly. I verified several of these specifically because they looked risky; they are correct (noted in §2–§5 so they aren't re-investigated).

**Deploy-readiness verdict: SHIP-ABLE, with one feature-level caveat.** There are no security holes or crash/boot blockers. However, the **Scheduled Publish / Scheduled Close feature is broken end to end** (see CRITICAL-1): any attempt to set a schedule returns a 400 and silently fails in the UI. If you are not using scheduled publish/close for this launch, you can deploy as-is and fix it in a follow-up. If you intend to use it, fix CRITICAL-1 first.

The authoritative live topology from the user's request (web on `qivo-web-dusky.vercel.app` calling the API on `qivo-production-*.up.railway.app` cross-origin) is consistent with the code: the frontend authenticates with a **Bearer token from localStorage**, not cookies, so the SameSite=Lax cross-site cookie limitation described in `config/cookie.ts` does not actually affect auth. See HIGH-2 for the nuance.

---

## 2. CRITICAL issues (deploy blockers / broken features / security)

### CRITICAL-1 — Scheduled publish / close is completely broken (datetime format mismatch)
- **Where:**
  - Editor input: `apps/web/src/pages/FormEditorPage.tsx:1043-1044` — `<input type="datetime-local">` bound to `scheduledPublishAt` / `scheduledCloseAt`.
  - Save payload: `apps/web/src/pages/FormEditorPage.tsx:585-586` — sends `scheduledPublishAt: scheduledPublishAt || null` (the raw input value).
  - Backend schema: `apps/api/src/modules/forms/form.schemas.ts:9-10` — `z.string().datetime().nullable().optional()`.
- **What's wrong:** An HTML `datetime-local` input produces a value like `2026-10-05T14:30` — **no seconds and no timezone/offset**. Zod's `z.string().datetime()` (zod 4.4.3 is installed) requires a full ISO-8601 instant with a `Z` or numeric offset (e.g. `2026-10-05T14:30:00Z`). The local value fails validation.
- **Impact:** Saving a form with any scheduled publish or close time returns `400 VALIDATION_ERROR` from `PATCH /api/forms/:formId/settings`. In the editor this surfaces as a generic "Unable to save settings" and the whole settings save fails (the schedule fields are in the same payload as collectEmail, quizMode, confirmation message, etc., so a user who sets a schedule can't save ANY settings on that form). The scheduled-publish timer (`publishDueForms`, `server.ts`) and the close check (`submitFormResponse`, `form.service.ts:1415`) therefore never receive data — the feature never works. The round-trip is also broken on load: even a correctly stored `...Z` string would not populate a `datetime-local` input (which needs `YYYY-MM-DDTHH:mm`).
- **Suggested fix:** Convert at the boundary. On save, turn the local value into a full ISO instant, e.g. `new Date(scheduledPublishAt).toISOString()` (guard empty string → null). On load, format the stored ISO string back to `datetime-local` shape (slice to `YYYY-MM-DDTHH:mm` in local time). Alternatively relax the schema to `z.coerce.date()` or accept the local format — but converting on the client is cleaner and keeps stored values as true UTC instants, which `publishDueForms`/`new Date(scheduledAt)` already expect.

---

## 3. HIGH issues (real bugs affecting users, not deploy blockers)

### HIGH-1 — Preview renderer coerces empty/partial NUMBER input to `0` / `NaN` (parity gap with public form)
- **Where:** `apps/web/src/pages/FormPreviewPage.tsx:49-51` (`handleInputChange`): `updateAnswer(questionId, event.target.type === "number" ? Number(event.target.value) : event.target.value)`.
- **What's wrong:** `Number("")` is `0` and `Number("12a")` is `NaN`. The public form (`PublicFormPage.tsx:120-137`) deliberately handles this: empty stays `""` (unanswered), non-numeric is rejected. The preview does not mirror this.
- **Impact:** Preview-only, so no bad data is persisted, but a NUMBER question in preview shows `0` the moment the field is cleared, and `NaN` on partial typing — misleading for the form owner validating their form. It also contradicts the brief's parity requirement between renderers.
- **Suggested fix:** Copy the public form's `handleInputChange` number handling into the preview page.

### HIGH-2 — Cookie auth is effectively dead; auth relies solely on the Bearer token (verify this is intended)
- **Where:** `apps/web/src/lib/api.ts` (`request`, `publicPost`, `publicGet`) never set `credentials: "include"`; `apps/api/src/config/cookie.ts` sets `sameSite: "lax"`; `apps/api/src/middleware/auth.ts:26-33` accepts the token from cookie **or** `Authorization: Bearer`.
- **What's wrong / nuance:** The API sets a `qivo_session` cookie on login/signup/google, but the browser client never sends it (no `credentials: "include"`, and cross-site Lax cookies wouldn't be sent on XHR anyway). Every authenticated request works purely via the localStorage Bearer token. This is internally consistent and actually side-steps the cross-origin cookie problem — but it means the httpOnly session cookie provides no protection (the token is readable JS in localStorage, an XSS-exfiltration surface) and the cookie code path is misleading dead weight.
- **Impact:** Not a functional bug (auth works), but a security-posture and clarity issue. If the intent was httpOnly-cookie auth for XSS resistance, it is not in force.
- **Suggested fix:** Decide on one model. If Bearer/localStorage is intended, document it and consider dropping the cookie set/clear code. If cookie auth is intended, set `credentials: "include"` on the client and `sameSite: "none"; secure: true` for the cross-site Vercel→Railway topology.

### HIGH-3 — `SESSION_COOKIE_NAME` env var is defined but ignored (cookie name hardcoded)
- **Where:** `apps/api/src/config/env.ts:20` declares `SESSION_COOKIE_NAME`; but `apps/api/src/modules/auth/auth.routes.ts` (`res.cookie("qivo_session", ...)` on login/signup/google/logout) and `apps/api/src/middleware/auth.ts:26` (`req.cookies?.qivo_session`) hardcode the literal `"qivo_session"`.
- **Impact:** Low in practice because the default matches, but if an operator sets a different `SESSION_COOKIE_NAME` (as `.env.example` and `DEPLOY.md` invite them to), login will set one cookie name while auth reads another — breaking cookie auth silently. Combined with HIGH-2 it currently has no effect, but it's a latent trap.
- **Suggested fix:** Read the name from `env.SESSION_COOKIE_NAME` in both the route and the middleware, or drop the env var.

---

## 4. MEDIUM issues (incomplete features, inconsistencies, hardening)

### MEDIUM-1 — Scheduled close never transitions the form to CLOSED
- **Where:** `apps/api/src/modules/forms/form.service.ts:1415-1421` (`submitFormResponse`) rejects submissions after `scheduledCloseAt`, but only per-request; nothing flips `status` to `CLOSED`.
- **Impact:** After the close time, `getPublicForm` still returns the form as PUBLISHED and respondents can load it and fill it out, only to be rejected on submit (poor UX). Analytics "view" events keep accruing. There is a timer for scheduled *publish* (`publishDueForms`) but no equivalent sweep for scheduled *close*.
- **Suggested fix:** Add a `closeDueForms()` sweep alongside `publishDueForms()` in `server.ts`, and/or have `getPublicForm` treat a past `scheduledCloseAt` as closed. (Depends on CRITICAL-1 being fixed first, since no valid close date can currently be stored.)

### MEDIUM-2 — `auth.service.ts` and `google.service.ts` hardcode `SESSION_DAYS = 30`, ignoring the env var
- **Where:** `apps/api/src/modules/auth/auth.service.ts:11` and `apps/api/src/modules/auth/google.service.ts:19` each define a local `const SESSION_DAYS = 30`. The session *cookie* maxAge honors `process.env.SESSION_DAYS` (`config/cookie.ts:14`), but the DB session `expiresAt` does not.
- **Impact:** If an operator sets `SESSION_DAYS` to something other than 30, the cookie lifetime and the server-side session expiry diverge. Minor; default is consistent.
- **Suggested fix:** Source the session lifetime from `env.SESSION_DAYS` in both services.

### MEDIUM-3 — Event Registration template uses `SHORT_TEXT` for the phone field
- **Where:** `apps/api/src/modules/forms/templates.ts` (Event Registration → "Phone Number" is `SHORT_TEXT`).
- **Impact:** No phone-shaped `type="tel"` keyboard/validation for a field clearly meant to be a phone number. Cosmetic/data-quality, not a bug. (A dedicated `PHONE` type exists and is fully supported.)
- **Suggested fix:** Change that template question's type to `PHONE`.

### MEDIUM-4 — `createQuestion` in the template path casts `type: q.type as any`
- **Where:** `apps/api/src/modules/forms/form.routes.ts` (`/from-template` handler) — `type: q.type as any`.
- **Impact:** The template question types bypass the Zod enum. If a template ever contains a typo or an unsupported type string, it is written to the schema unchecked and would then fail validation/rendering downstream. Current templates only use valid types, so no live bug.
- **Suggested fix:** Validate `q.type` against `questionTypeSchema` (or type `TemplateQuestion.type` as `QuestionType`) instead of `as any`.

---

## 5. LOW / polish

- **LOW-1 — Dead "Media / add image" button.** `apps/web/src/pages/FormEditorPage.tsx:1003` — `onClick={() => {/* Future: add image */}}`. The floating toolbar's "🖼 Media" button does nothing. Either hide it until implemented or wire it up, so it isn't a visibly dead control.
- **LOW-2 — `deleteSectionById` does a full `window.location.reload()`** (`FormEditorPage.tsx`) after deleting a section instead of updating state. Works, but drops unsaved debounced edits and is jarring. Consider re-fetching questions into state instead.
- **LOW-3 — `metadata as any` casts in notifications.** `apps/api/src/modules/notifications/notification.service.ts:26` (`metadata: input.metadata as any`). Harmless (Prisma JSON), but prefer `Prisma.InputJsonValue`.
- **LOW-4 — Email service logs response bodies.** `apps/api/src/services/email.ts:60` logs the Resend response text at info level. Fine for now; avoid logging if the provider ever echoes PII.
- **LOW-5 — Report sample cap vs. export cap are independent 5000 limits.** `getFormReport` (`REPORT_SAMPLE_CAP = 5000`) and the dashboard export loop (`ResponseDashboardPage.tsx fetchAllResponses` caps at ~5000) are consistent, but neither surfaces to the user that very large forms are sampled. Minor UX note.

---

## 6. Per-question-type lifecycle matrix

Legend: ✅ handled correctly · ➖ handled by a correct generic/fallthrough path (not a gap) · ❌ gap.

Columns: **Editor** (type selector + settings UI) · **Public** (`PublicFormPage`) · **Preview** (`FormPreviewPage`) · **BE validate** (`validateAnswerAgainstQuestion`) · **Req-check** (`submitFormResponse` missing-required) · **Reports** (`getFormReport`) · **Resp display** (`ResponseDashboardPage` + CSV/Excel).

| Type | Editor | Public | Preview | BE validate | Req-check | Reports | Resp display |
|---|---|---|---|---|---|---|---|
| SHORT_TEXT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ text | ✅ |
| LONG_TEXT | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ text | ✅ |
| EMAIL | ✅ | ✅ | ✅ | ✅ regex | ✅ | ✅ text | ✅ |
| NUMBER | ✅ | ✅ | ⚠️ 0/NaN (HIGH-1) | ✅ | ✅ | ✅ number | ✅ |
| DATE | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ text | ✅ |
| SINGLE_CHOICE | ✅ | ✅ | ✅ | ✅ option check | ✅ | ✅ choice | ✅ |
| MULTIPLE_CHOICE | ✅ | ✅ | ✅ | ✅ option check | ✅ (array) | ✅ choice | ✅ join |
| RATING | ✅ min/max | ✅ | ✅ | ✅ numeric | ✅ | ✅ rating | ✅ |
| YES_NO | ✅ | ✅ | ✅ | ✅ yes/no/bool | ✅ | ✅ choice | ✅ |
| PHONE | ✅ | ✅ | ✅ | ✅ (text) | ✅ | ✅ text | ✅ |
| URL | ✅ | ✅ | ✅ | ✅ `new URL()` | ✅ | ✅ text | ✅ |
| FILE_UPLOAD | ✅ size/types | ✅ Cloudinary | ➖ static preview | ✅ http(s) URL | ✅ | ➖ text (link/img) | ✅ link/img |
| LINEAR_SCALE | ✅ min/max/labels | ✅ | ✅ | ✅ numeric | ✅ | ✅ rating | ✅ |
| MULTI_ENTRY | ✅ static preview | ✅ dynamic list | ✅ dynamic list | ✅ array of non-blank strings | ✅ array-of-blanks = missing | ✅ flattened entries | ✅ join |

**No ❌ gaps.** The two notes:
- NUMBER/Preview is HIGH-1 (preview-only coercion bug, does not affect persisted data).
- FILE_UPLOAD preview is intentionally a static drop-zone ("preview only"); reports route FILE_UPLOAD through the text bucket where `renderSampleAnswer`/`renderAnswerValue` turn URLs into thumbnails or "View file" links — correct behavior, not a gap.

MULTI_ENTRY verified end-to-end: `types/index.ts` union, `form.schemas.ts` enum, `form.service.ts` local union + `validateAnswerAgainstQuestion` (array of non-blank strings) + required-check (array of all-blank = missing), `FormEditorPage` label + static preview, `PublicFormPage` dynamic add/remove list with `[""]` floor and remove-button guard, `FormPreviewPage` mirror, `getFormReport` array flattening into individual text samples, `ResponseDashboardPage` `formatResponseValue` join + CSV/Excel.

---

## 7. Things verified as CORRECT (do not re-investigate)

- **CSRF + public submit:** `middleware/csrf.ts` exempts `/public/` paths and Bearer-authenticated requests, and requires a matching Origin/Referer for cookie/ambient state-changing requests. Public form POST (`/api/forms/public/:slug/responses`) is correctly exempt — this matches the user's reported working submission.
- **CORS:** `app.ts` parses `WEB_URL` as a comma-separated allow-list, strips trailing slashes, allows no-Origin (curl/health), and sets `credentials: true`. Correct for the Vercel↔Railway setup.
- **Rate limiting ordering:** public form limiter (500/15min) is mounted before the global `/api` limiter, and the global limiter skips `/forms/public` — so public submissions aren't throttled by the stricter 100/15min bucket. Matches the `ratelimit "500-in-15min"` header the user saw.
- **Duplicate-response race:** DB unique index `@@unique([formId, respondentEmail])` + a friendly pre-check + P2002 catch in `submitFormResponse`. NULL `respondentEmail` for multi-response/anonymous forms correctly avoids collisions.
- **Quiz answer-key leakage:** `stripAnswerKeys` removes `correctAnswer`/`points` from every question in the public payload (`getPublicForm`). Scoring happens server-side in `submitFormResponse`.
- **Conditional visibility parity:** server `isQuestionVisible` (`form.service.ts`) mirrors client `evaluateConditions` (`lib/conditions.ts`) for all four operators (equals / not_equals / contains / not_empty), including array handling. Both the required-check and the per-answer validation loop use the same visibility gate, so hidden required questions aren't falsely flagged.
- **VIEWER vs EDITOR/ADMIN/OWNER enforcement:** `getEditableForm` (role ≠ VIEWER) for mutations; `getFormForResponseAccess` blocks VIEWERs from response data (404 vs 403 disambiguation); members module (`requireManagerRole`), approvals module (OWNER/ADMIN reviewer), and workspace rename/branding all enforce roles.
- **Google OAuth:** verifies the ID token audience, and rejects `email_verified !== true` before linking to an existing account (prevents account-takeover via unverified Google email). Password-less accounts use a sentinel so password login can't succeed.
- **Publish transaction:** version snapshot + status flip in a single `$transaction` with the version re-read inside — no orphaned version rows.
- **Prisma schema vs. usage:** fields referenced in code (`respondentEmail`, `googleId`, `verifyToken*`, `resetToken*`, `FormVersion`, `FormAnalytics`, etc.) all exist in `prisma/schema.prisma`; the duplicate-response unique constraint and the relevant indexes are present. `publishDueForms` filters in memory (schema JSON isn't queryable), which is acceptable at current scale.
- **Env var consistency:** every `process.env.X` read by the API (`DATABASE_URL`, `DIRECT_URL` via `prisma.config.ts`, `PORT`, `NODE_ENV`, `WEB_URL`, `SESSION_COOKIE_NAME`, `SESSION_DAYS`, `EMAIL_FROM`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`, `CLOUDINARY_*`) is documented in `.env.example`. Cloudinary and Resend both degrade gracefully when unset (`isCloudinaryConfigured` / `signUpload` throws `UPLOAD_NOT_CONFIGURED`; email falls back to console logging).
- **Type checks:** both apps compile with zero errors (commands and results in §1).

---

## 8. Recommendation

Fix **CRITICAL-1** before relying on scheduled publish/close (it's a small, localized client-side date conversion). If scheduling isn't needed for this launch, the app is safe to deploy now; address HIGH-1/2/3 and the MEDIUM items in a follow-up pass. Nothing here blocks the Railway boot, migrations, CORS, or public form submission that the user has already confirmed working.
