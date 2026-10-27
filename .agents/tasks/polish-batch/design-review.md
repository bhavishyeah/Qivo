# Design Review — Polish Batch (3 features)

**Design under review:** `c:\Qivo\.agents\tasks\polish-batch\design.md`
**Scope:** per-form theme / Appearance tab; same-session secure response editing; array answers as chips.
**Reviewer stance:** fresh read, every code claim re-verified against the live `apps/api` / `apps/web` / `prisma` sources.

**Verdict:** APPROVED (0 HIGH, 0 MEDIUM, 3 NIT).

This is a mature design on its third revision. The prior review iterations already drove out the structural risks (edit-form lookup scoping, unexecutable test plan, unwired error names, closed-form error-name conflict, allow-list drift). I re-verified each of those against source and confirm they are resolved. The six items the review brief specifically flagged all check out against the real codebase. The remaining findings are cosmetic/under-specification NITs that do not block implementation.

---

## Findings

### NIT 1 — §2.5 step 4 does not pin the `select`/fields the response load must return

**Where:** Feature 2, §2.5 step 4 ("Load the response (`id === responseId AND formId === form.id`)") vs step 7, which reads `existing.metadata`.

**Problem:** Step 4 describes loading the response but does not name the columns the query must return. Step 7 then spreads `...(existing.metadata as Record<string, unknown> ?? {})`. If the implementer writes a `findFirst({ where: ... })` with a narrow `select`, `existing.metadata` could be absent. The intent is obvious but not pinned, and the rest of the design is pinned to this level of precision, so it's worth closing.

**Fix:** Add to step 4: the response load must `select` (or return) at minimum `id`, `metadata`, and `submittedAt` so step 7's metadata merge and the return shape work. Concretely:

```ts
const existing = await prisma.formResponse.findFirst({
  where: { id: responseId, formId: form.id },
  select: { id: true, metadata: true, submittedAt: true },
});
if (!existing) throw RESPONSE_NOT_FOUND; // 404
```

(`answers` is supplied by the request body, not read from the row, so it need not be selected.)

### NIT 2 — `apps/web/src/lib/upload.ts` already exists; "Files touched" lists it as if net-new

**Where:** §1.7 and the "Files touched" summary: "`src/lib/upload.ts` — extract `uploadToCloudinary(slug, file, onProgress?)` …".

**Problem (verified):** `apps/web/src/lib/upload.ts` already exists and already exports `maybeCompressImage` and `isImageUrl` (both consumed by `PublicFormPage.tsx`). The design's phrasing reads like a new file. It is harmless — the file is the correct home for the extracted `uploadToCloudinary` — but an implementer skimming "Files touched" might scaffold a fresh file and clobber the existing exports.

**Fix:** Reword to "**extend existing** `src/lib/upload.ts` (currently exports `maybeCompressImage`, `isImageUrl`) with `uploadToCloudinary(slug, file, onProgress?)`, reusing `maybeCompressImage` already in that module and `publicPost` from `src/lib/api.ts`."

### NIT 3 — `isQuestionVisible` must be relocated/parameterized when extracting `validateSubmission`

**Where:** §2.5 step 6 — extract `validateSubmission(schema, answers)` with the visibility-aware required check.

**Problem (verified):** In `submitFormResponse` the required-check calls `isQuestionVisible(question)`, which is a **nested function closing over `input.answers`** (form.service.ts ~lines 1676–1706). Pulling the three gates into a free `validateSubmission(schema, answers)` helper means `isQuestionVisible` must also move into the helper (or be parameterized to take `answers`), otherwise the helper won't compile / will reference the wrong `answers`. The design pins the helper's three-gate boundary precisely but doesn't mention that this closure travels with it.

**Fix:** Add a sentence to step 6: "`isQuestionVisible` is currently a closure over `input.answers` inside `submitFormResponse`; move it inside `validateSubmission` (or give it an explicit `answers` parameter) so the extracted helper is self-contained. The conditional-visibility operator logic is copied verbatim — no behavior change."

---

## Verified Assumptions

Each of the following design claims was checked against source and holds:

1. **CSRF exemption (design decision 6, §2.5).** `apps/api/src/middleware/csrf.ts` contains `if (req.path.includes("/public/")) { next(); return; }`. The new edit route `POST /api/forms/public/:slug/responses/:responseId/edit` is under `/public/`, so it is CSRF-exempt by the exact same mechanism as the submit route. **Confirmed.**

2. **No suitable existing signing secret; `RESPONSE_EDIT_SECRET` must be added (§2.3).** `apps/api/src/config/env.ts` exposes only `NODE_ENV, PORT, DATABASE_URL, WEB_URL, SESSION_COOKIE_NAME, SESSION_DAYS` — no `SESSION_SECRET`/`JWT_SECRET`. The `optional(key, fallback)` helper signature matches the design's proposed `optional("RESPONSE_EDIT_SECRET", "dev-insecure-…")` call exactly. **Confirmed — adding the var is necessary and the call shape is correct.**

3. **`node:crypto` already used by `cloudinary.ts` (§2.3).** `cloudinary.ts` imports `createHash` from `node:crypto` and uses SHA-1 for the upload signature. The design correctly notes this and instructs the implementer to import `createHmac`/`timingSafeEqual` instead. **Confirmed.**

4. **Three new error names are NOT in the `app.ts` switch; the three reused ones ARE (§2.8).** `apps/api/src/app.ts` `switch (error.name)` has `PUBLIC_FORM_NOT_FOUND` (404), `RESPONSE_NOT_FOUND` (404), `INVALID_RESPONSE` (400), `FORM_CLOSED` (410), and a `default` → 500. It does **not** have `INVALID_EDIT_TOKEN`, `EDITING_DISABLED`, or `EDIT_WINDOW_EXPIRED`. The design's instruction to add exactly those three as 403 cases is correct and necessary. **Confirmed.**

5. **Submit lookup hard-filters `status: "PUBLISHED"` (§2.5 step 3 rationale).** `submitFormResponse` does `prisma.form.findFirst({ where: { slug, status: "PUBLISHED", deletedAt: null } })` (form.service.ts ~line 1617). Reusing it on the edit path would 404 a CLOSED form; the design's dedicated `status: { in: ["PUBLISHED", "CLOSED"] }` edit lookup is justified. **Confirmed.**

6. **`closeDueForms()` flips forms to `status: "CLOSED"` on a timer (§2.5 step 3/5).** Exists in form.service.ts (~line 1475), called from `server.ts` scheduler, sets `data: { status: "CLOSED" }`. So "status is CLOSED" and "scheduledCloseAt elapsed" are two independent close paths — the design handles both. **Confirmed.**

7. **The three submit-path validation gates (§2.5 step 6 helper boundary).** form.service.ts: unknown-question-id rejection (~1662), visibility-aware required check with the `MULTI_ENTRY` empty-array special-case (~1707), per-answer `validateAnswerAgainstQuestion` loop (~1732). The `EMAIL_REQUIRED` (~1646 and ~1753) and `DUPLICATE_RESPONSE` (~1762) checks live **outside** those three gates. The design's "helper = these three gates only, no email, no duplicate" boundary is accurate. **Confirmed.**

8. **Quiz-scoring block exists and is extractable (§2.5 step 7).** The `if (schema.settings.quizMode) { … isAnswerCorrect … }` block is at form.service.ts ~lines 1892–1913, returning `{ earned, total, percentage }`. Extraction into `computeQuizScore(schema, answers)` shared by submit + edit is feasible. **Confirmed.**

9. **`getFormSchema` conditional-spread pattern (§1.1).** form.service.ts uses `...(candidate?.settings?.scheduledPublishAt !== undefined ? {…} : {})` etc. The design's `theme` conditional-spread mirrors this exactly; absent `theme` stays absent. **Confirmed.**

10. **`getPublicForm` curation lets `theme`/editing fields ride through (§1.4, §2.2).** It destructures `const { responseNotification, sendConfirmationEmail, ...publicSettings } = schema.settings;` then emits `settings: publicSettings`. New fields not in the omit-list flow through automatically; `branding` (with `primaryColor`) is still emitted. **Confirmed.**

11. **`FormResponse` has `metadata Json?` and `submittedAt DateTime @default(now())` (§2.5 step 7, decision 5).** `prisma/schema.prisma` (root, not `apps/api/prisma`) confirms both. `editedAt` in `metadata` needs no migration; `submittedAt` is unchanged by an `update` that doesn't write it. **Confirmed — whole batch is migration-free.**

12. **Submit route response shape (§2.4/§2.6).** form.routes.ts `POST /public/:slug/responses` returns `data: { response: { id, submittedAt }, ...(response.quizScore ? { quizScore } : {}) }`. Adding `editToken` and the parallel edit route fits cleanly. **Confirmed.**

13. **`submitResponseSchema` shape for `.extend({ editToken })` (§2.5).** form.schemas.ts defines `submitResponseSchema = z.object({ answers, email?, metadata? })`. `.extend(...)` is valid. **Confirmed.**

14. **Zod v4 in both apps; `z.strictObject` / `z.enum` / `z.coerce` available (§1.2, §2.1).** Both `apps/api` and `apps/web` on `zod@^4.4.3`. API schemas already use v4 idioms (`z.email()`, `z.record(z.string(), z.unknown())`). `z.strictObject` and the deprecation note about `z.object().strict()` are correct for v4. **Confirmed.**

15. **No API test runner; web has Vitest (§0).** `apps/api/package.json` `test` script is `echo "Error: no test specified" && exit 1`, no `vitest` dev dep. `apps/web` has `vitest@^3.2.4`. The §0 prerequisite (add Vitest to API first) is accurate and justified. **Confirmed.**

16. **`.submit-button { background: #2563eb }` == `DEFAULT_ACCENT` (§1.5).** `apps/web/src/App.css` `.submit-button` has `background: #2563eb`. So an un-themed form with `accent: undefined` falls through to this CSS and keeps today's exact pixels; `DEFAULT_ACCENT = "#2563eb"` reproduces it where a literal is needed. **Confirmed.**

17. **PublicFormPage inline-style conditional spreads (§1.5).** Lines ~343 (eyebrow `color`), ~430 and ~439 (submit/next `background`) use `...(form.branding?.primaryColor ? {…} : {})`. Replacing the reads with `resolved.accent` while keeping the conditional-spread shape preserves the undefined→no-inline-style behavior. **Confirmed.**

18. **`FormRecord` has no `branding`/`primaryColor`; `PublicForm` does (§1.5, decision 9).** `apps/web/src/types/index.ts`: `PublicForm.branding?.{ workspaceName, logoUrl?, primaryColor? }`; `FormRecord` has only `schema` + metadata, no branding. The accepted preview-parity gap is real and correctly reasoned. **Confirmed.**

19. **`uploadFileToCloudinary` is signature-based and extractable (§1.7).** `PublicFormPage.uploadFileToCloudinary` does `publicPost('/api/forms/public/:slug/upload-signature')` then direct Cloudinary XHR with progress. Extraction to `uploadToCloudinary(slug, file, onProgress?)` is feasible; `publicPost` and `maybeCompressImage` are both available. **Confirmed.**

20. **`getUploadSignatureForForm` is gated on `status: "PUBLISHED"` and 404s otherwise (§1.7).** form.service.ts: `findFirst({ where: { slug, status: "PUBLISHED", deletedAt: null } })` → throws `PUBLIC_FORM_NOT_FOUND` when absent. The design's "gate the editor upload button on `form.status === 'PUBLISHED'` instead of inferring from the ambiguous 404" is sound. **Confirmed.**

21. **Feature 3 render surfaces exist and exports stay comma-joined (§3).** `ResponseDashboardPage.renderAnswerValue` has the URL/thumbnail branch and falls through to `formatResponseValue`; `formatResponseValue` joins arrays with `", "` and is used by both CSV and Excel export paths. `FormReportsPage.renderSampleAnswer(answer: string)` is called per `report.sample[]` element; `TextReport.sample: string[]`. The chip wiring and "exports unchanged" claims are accurate. **Confirmed.**

22. **`metadata` is rendered as a `<pre>` JSON block in the response dashboard (§2.11 item 1).** `ResponseDashboardPage.tsx` ~lines 470–475 render `<pre>{JSON.stringify(response.metadata, null, 2)}</pre>`, so `metadata.editedAt` is visible for free. **Confirmed.**

---

## Unverified / Wrong Assumptions

None found. Every code reference in the design that this review could reach was checked against source and matched. The line numbers quoted in the design ("~1619", "~1707–1752", "~1892–1910", "~470–475", etc.) are all within ~1–3 lines of the actual locations in the current tree — close enough to be unambiguous and not misleading.

One item worth stating explicitly (not a finding, since the design never claims otherwise): the Prisma schema lives at the repo root `c:\Qivo\prisma\schema.prisma`, not `apps/api/prisma/`. This does not affect any design claim because the batch is migration-free and the design references no schema path.
