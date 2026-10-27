# Implementation Plan — Polish Batch (3 features)

Follows the APPROVED design at `.agents/tasks/polish-batch/design.md`. Do NOT re-decide architecture; this plan sequences the design. All work is in one worktree; commit locally only — NO push, NO PR.

Verified baselines before starting (both exit 0):
- API: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit`
- Web: `cd apps/web && pnpm exec tsc -b --noEmit`

Key verified facts grounding this plan:
- `apps/api` has NO test runner (`"test": "echo ... exit 1"`); `apps/web` already has `vitest@^3.2.4`.
- API tsconfig sets `exactOptionalPropertyTypes: true` and `strict: true` — optional fields must be added with conditional-spread, never `key: undefined`.
- `getPublicForm` destructures only `responseNotification`/`sendConfirmationEmail` out of `publicSettings`; any new settings field rides through automatically.
- `app.ts` error handler is a `switch (error.name)` with a 500 default; `PUBLIC_FORM_NOT_FOUND` (404), `RESPONSE_NOT_FOUND` (404), `INVALID_RESPONSE` (400), `FORM_CLOSED` (410) already have cases.
- `csrf.ts` exempts any path containing `/public/`.
- `env.ts` `optional(key, fallback)` takes exactly two args.
- `cloudinary.ts` imports from `node:crypto` (`createHash`).
- `FormRecord` has no `branding`; only `PublicForm` does.
- Submit route returns `{ response: { id, submittedAt }, quizScore? }`; `submitFormResponse` returns `{ ...response, quizScore }`.

---

## Prerequisite

- [ ] 1. Add Vitest to `apps/api` (design §0) so the security-critical token + schema unit tests are runnable.
      Add `vitest` (`^3.2.4`, matching web) to `apps/api` devDependencies; replace the stub `"test"` script with `"test": "vitest run"` and add `"test:watch": "vitest"`. Create `apps/api/vitest.config.ts` with `test: { environment: "node", include: ["src/**/*.test.ts"] }`.
      Files: `apps/api/package.json`, `apps/api/vitest.config.ts`
      Verify: `cd apps/api && pnpm install && pnpm test` runs (0 tests is fine at this point; the command must not error on config).

---

## Feature 1 — Per-form theme / Appearance tab

- [ ] 2. Extend the API `FormSchema.settings` type and `getFormSchema` defaults for `theme` (design §1.1).
      Add `FormTheme` type (`coverImageUrl?`, `accentColor?`, `backgroundColor?`, `fontFamily?` all optional) and `theme?: FormTheme` to the `FormSchema.settings` type in `form.service.ts`. In `getFormSchema`, copy `theme` through ONLY when present using the existing conditional-spread pattern (`...(candidate?.settings?.theme !== undefined ? { theme: candidate.settings.theme } : {})`) — never fabricate `{}`.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 3. Add `FONT_ALLOW_LIST` and `themeSchema` to the Zod settings schema (design §1.2, §1.11).
      In `form.schemas.ts` export `FONT_ALLOW_LIST` (the 8 families: Inter, Roboto, Poppins, Montserrat, Open Sans, Lora, Playfair Display, Source Sans 3) with a cross-ref comment naming `apps/web/src/lib/theme.ts` as the mirror and stating the API enum is authoritative. Add `HEX_COLOR` regex and a `themeSchema` using `z.strictObject({ coverImageUrl: z.string().trim().url().max(2000).optional(), accentColor: HEX_COLOR.optional(), backgroundColor: HEX_COLOR.optional(), fontFamily: z.enum(FONT_ALLOW_LIST).optional() }).optional()`. Add `theme: themeSchema` to `updateFormSettingsSchema`.
      Files: `apps/api/src/modules/forms/form.schemas.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 4. Merge `theme` in `updateFormSettings` as a whole-object replace (design §1.3).
      Add `...(input.theme !== undefined ? { theme: input.theme } : {})` to the settings spread in `updateFormSettings`. Existing scalars keep their per-field conditional spread.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 5. Add API unit tests for the theme schema (design §1.10).
      New `apps/api/src/modules/forms/form.schemas.test.ts`: `updateFormSettingsSchema` accepts a valid theme; rejects bad hex, a non-allow-list font, a non-URL cover, and unknown keys (`z.strictObject`); assert `FONT_ALLOW_LIST` deep-equals the 8 expected family names.
      Files: `apps/api/src/modules/forms/form.schemas.test.ts`
      Verify: `cd apps/api && pnpm test` — new tests pass.

- [ ] 6. Add the web `theme.ts` helper module (design §1.5, §1.6, §1.11).
      New `apps/web/src/lib/theme.ts`: export `DEFAULT_ACCENT = "#2563eb"`; `FONT_ALLOW_LIST` mirror with cross-ref comment; a per-family font-href + CSS-fallback-stack map; `resolveTheme(theme, primaryColor?)` returning `{ accent, background, fontFamily, coverImageUrl }` where `accent = theme?.accentColor ?? primaryColor ?? undefined` (returns `undefined` when both absent — never substitutes `DEFAULT_ACCENT`), and the other fields pass through `undefined` when unset; `ensureFontLoaded(family?)` that injects a deduped `<link>` (guarded by `data-qivo-font`) and no-ops on undefined.
      Files: `apps/web/src/lib/theme.ts`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 7. Add web unit tests for `theme.ts` (design §1.10, §1.11).
      New `apps/web/src/lib/theme.test.ts`: `resolveTheme` precedence (theme → primaryColor → default; and preview mode with `primaryColor` omitted → `accent` is `undefined` when no theme accent); `ensureFontLoaded` injects once and no-ops on undefined; `FONT_ALLOW_LIST` drift guard deep-equals the 8 expected names.
      Files: `apps/web/src/lib/theme.test.ts`
      Verify: `cd apps/web && pnpm test` — new tests pass.

- [ ] 8. Extend web `FormSchema.settings` type with `theme` (and the Feature-2 editing fields) (design §1.8).
      Add `FormTheme` type and `theme?: FormTheme`, `responseEditing?: "disabled" | "timed" | "until_close"`, `responseEditMinutes?: number` to `FormSchema.settings` in `types/index.ts`.
      Files: `apps/web/src/types/index.ts`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 9. Extract the Cloudinary upload flow into a reusable web helper (design §1.7).
      New `apps/web/src/lib/upload.ts`: `uploadToCloudinary(slug, file, onProgress?)` lifting the signature → direct-Cloudinary XHR flow from `PublicFormPage.uploadFileToCloudinary` (keep the image-compress call and the image/raw resource-type logic). Refactor `PublicFormPage` to call it so behavior is unchanged.
      Files: `apps/web/src/lib/upload.ts`, `apps/web/src/pages/PublicFormPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 10. Add the Appearance tab + controls + live preview to the editor (design §1.7).
      In `FormEditorPage.tsx`: extend `EditorTab` with `"appearance"`; add the tab button and panel; add state `coverImageUrl/accentColor/backgroundColor/fontFamily` loaded from `schema.settings.theme` on form load. Controls: cover-image Cloudinary upload (gated on `form.status === "PUBLISHED"` with the "publish to upload / paste URL" note) + URL paste + Remove, accent `<input type="color">` + reset, background color + reset, font `<select>` from `FONT_ALLOW_LIST` with a Default option, and a scaled live preview using `resolveTheme` + `ensureFontLoaded`. Fold the theme into `saveFormSettings`: build a `theme` object from set fields only and send `body.theme = theme` (empty object clears theming).
      Files: `apps/web/src/pages/FormEditorPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 11. Apply the resolved theme on `PublicFormPage` (design §1.5).
      Call `resolveTheme(form.schema.settings.theme, form.branding?.primaryColor)` + `ensureFontLoaded`. Replace the three `form.branding?.primaryColor` inline reads (eyebrow color ~L343, next button ~L430, submit button ~L439) with `resolved.accent`, keeping the conditional-spread shape so `undefined` emits no inline style. Apply `background`/`fontFamily` to the `.public-form-shell`/`-wrap` container only when set; render a cover banner `<img>` at the top of `.public-form-wrap` only when set.
      Files: `apps/web/src/pages/PublicFormPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 12. Apply the resolved theme on `FormPreviewPage` for parity (design §1.5, §1.9 preview gap).
      Call `resolveTheme(form.schema.settings.theme)` (no `primaryColor` — `FormRecord` has none) + `ensureFontLoaded`. Apply accent to the eyebrow + submit/next buttons (use `resolved.accent ?? DEFAULT_ACCENT` for the preview's custom buttons), background + font to the container, cover banner when set. Add the caption "Workspace brand color is applied on the live form."
      Files: `apps/web/src/pages/FormPreviewPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

---

## Feature 2 — Same-session secure response editing

- [ ] 13. Add `responseEditing`/`responseEditMinutes` to the API schema type, defaults, Zod, and merge (design §2.1).
      In `form.service.ts`: add both fields to the `FormSchema.settings` type; default them in `getFormSchema` to `"disabled"` and `15` (concrete defaults, not conditional); merge both in `updateFormSettings` via per-field conditional spread. In `form.schemas.ts`: add `responseEditing: z.enum(["disabled","timed","until_close"]).optional()` and `responseEditMinutes: z.coerce.number().int().min(1).max(1440).optional()` to `updateFormSettingsSchema`.
      Files: `apps/api/src/modules/forms/form.service.ts`, `apps/api/src/modules/forms/form.schemas.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 14. Add `RESPONSE_EDIT_SECRET` to env config + `.env.example` (design §2.3).
      In `env.ts` add `RESPONSE_EDIT_SECRET: optional("RESPONSE_EDIT_SECRET", "dev-insecure-response-edit-secret-change-me")` and a boot `console.warn` when `NODE_ENV === "production"` and the var is unset. Document it in `.env.example` under the API section.
      Files: `apps/api/src/config/env.ts`, `.env.example`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 15. Create the HMAC edit-token service (design §2.3).
      New `apps/api/src/services/responseEditToken.ts` importing `createHmac` + `timingSafeEqual` from `node:crypto`: `signEditToken(responseId, expiresAt)` → `base64url(payload).base64url(hmac)` with payload `{ rid, exp }`; `verifyEditToken(token)` → `{ responseId, exp } | null`, returning `null` on malformed input / bad signature (constant-time compare) / JSON parse failure; does NOT check expiry (caller re-checks).
      Files: `apps/api/src/services/responseEditToken.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 16. Add API unit tests for the token service (design §2.10) — the security core.
      New `apps/api/src/services/responseEditToken.test.ts` (inject a known `RESPONSE_EDIT_SECRET` via `process.env`): sign/verify round-trip; `null` for tampered payload, bad signature, garbage, truncated token, and token with no `.`; verify `timingSafeEqual` is used.
      Files: `apps/api/src/services/responseEditToken.test.ts`
      Verify: `cd apps/api && pnpm test` — new tests pass.

- [ ] 17. Extract `validateSubmission` and `computeQuizScore` shared helpers from `submitFormResponse` (design §2.5 step 6, step 7).
      In `form.service.ts` extract `validateSubmission(schema, answers)` containing ONLY the three answer gates (unknown-question rejection, visibility-aware required check incl. the MULTI_ENTRY empty-array special-case, per-answer `validateAnswerAgainstQuestion` loop) — NO email-required, NO duplicate logic. Extract `computeQuizScore(schema, answers)` from the quiz-scoring block (returns `null` when `quizMode` off). Rewire `submitFormResponse` to call both; keep its `EMAIL_REQUIRED`/`DUPLICATE_RESPONSE` gates wrapped around `validateSubmission`.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0; `pnpm test` still passes.

- [ ] 18. Add API unit test for `validateSubmission` (design §2.10).
      In a new or existing `*.test.ts` next to `form.service.ts` (or a dedicated `validateSubmission.test.ts` if the helper is exported), assert it throws `INVALID_RESPONSE` for unknown question id, missing required (incl. MULTI_ENTRY empty array), and type-mismatched answer; passes a valid payload. (Export the helper if needed for the test.)
      Files: `apps/api/src/modules/forms/form.service.ts` (export), new `*.test.ts`
      Verify: `cd apps/api && pnpm test` — new tests pass.

- [ ] 19. Issue the edit token in `submitFormResponse` and return it from the submit route (design §2.4, §2.6).
      In `submitFormResponse`, after the response is created, compute `editToken` from the mode (`disabled` → null; `timed` → now + minutes; `until_close` → min(scheduledCloseAt, now+24h) or now+24h), using `computeQuizScore`. Return `{ ...response, quizScore, editToken }`. In `form.routes.ts` submit route add `...(response.editToken ? { editToken: response.editToken } : {})` to the response body.
      Files: `apps/api/src/modules/forms/form.service.ts`, `apps/api/src/modules/forms/form.routes.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 20. Add `editResponseSchema` and the `editFormResponse` service (design §2.5).
      In `form.schemas.ts`: `editResponseSchema = submitResponseSchema.extend({ editToken: z.string().min(1).max(2000) })`. In `form.service.ts`: `editFormResponse(slug, responseId, input, editToken)` doing, in order — verify token (null → `INVALID_EDIT_TOKEN` 403), `rid` must equal `responseId` (mismatch → `INVALID_EDIT_TOKEN` 403 + `console.warn`), dedicated `status IN [PUBLISHED, CLOSED]` form lookup (none → `PUBLIC_FORM_NOT_FOUND` 404), load response scoped by `formId` (none → `RESPONSE_NOT_FOUND` 404), re-check mode/window (`disabled` → `EDITING_DISABLED` 403; `timed` expiry → `EDIT_WINDOW_EXPIRED` 403; `until_close` CLOSED or elapsed → `EDIT_WINDOW_EXPIRED` 403, NEVER `FORM_CLOSED`; token `exp` upper bound → `EDIT_WINDOW_EXPIRED` 403), re-run `validateSubmission(schema, answers)` only (no email/dup), overwrite `answers` + stamp `metadata.editedAt`, return `{ id, submittedAt (original), quizScore (recomputed via computeQuizScore) }`.
      Files: `apps/api/src/modules/forms/form.schemas.ts`, `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 21. Add the edit route and wire the 3 new error names into `app.ts` (design §2.5, §2.8).
      In `form.routes.ts` add public route `POST /public/:slug/responses/:responseId/edit` parsing `editResponseSchema`, passing `req.body.editToken` (post-validation) to `editFormResponse`, returning `{ response: { id, submittedAt }, quizScore? }`. In `app.ts` add three 403 cases: `INVALID_EDIT_TOKEN`, `EDITING_DISABLED`, `EDIT_WINDOW_EXPIRED`.
      Files: `apps/api/src/modules/forms/form.routes.ts`, `apps/api/src/app.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0.

- [ ] 22. Add the editing-mode controls to the editor Settings tab (design §2.1).
      In `FormEditorPage.tsx` add `responseEditing`/`responseEditMinutes` state loaded from `schema.settings`, a Settings-tab control (mode select + minutes input shown when `timed`), and include both in the `saveFormSettings` PATCH body.
      Files: `apps/web/src/pages/FormEditorPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 23. Add the "Edit my response" flow to `PublicFormPage` (design §2.7).
      Add same-session state `responseId/editToken/editWindowExpiresAt/isEditing`. On submit success capture `response.id` + `editToken` and compute the client window end. On the confirmation screen show an "Edit my response" button + note when a token exists and the window hasn't client-side-expired; clicking sets `isEditing`, clears `submitted`, re-renders prefilled from in-memory `answers`. Branch `handleSubmit` to call the edit endpoint when editing; on success return to confirmation keeping the same token. Add a `setInterval`/`setTimeout` to hide the button at expiry (UX only). Map a 403 `EDIT_WINDOW_EXPIRED`/`EDITING_DISABLED`/`INVALID_EDIT_TOKEN` to the design's messages.
      Files: `apps/web/src/pages/PublicFormPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

---

## Feature 3 — Array answers as chips (display only)

- [ ] 24. Add the reusable `Chips` component (design §3.2).
      New `apps/web/src/components/Chips.tsx` rendering `—` for an empty array and index-keyed chips (indigo `#eef2ff`/`#3730a3`, pill radius, `overflow-wrap: anywhere`) otherwise.
      Files: `apps/web/src/components/Chips.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 25. Render chips in `ResponseDashboardPage.renderAnswerValue` (display only) (design §3.3).
      Add an `Array.isArray(value)` branch at the top of `renderAnswerValue` → `<Chips items={value.map(v => String(v).trim()).filter(Boolean)} />`. Do NOT touch `formatResponseValue`, `downloadResponsesCsv`, or `downloadResponsesExcel` (exports stay comma-joined).
      Files: `apps/web/src/pages/ResponseDashboardPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 26. Render chips in `FormReportsPage` text-report samples (design §3.3).
      Update the `report.sample.map(...)` block so each non-URL sample renders via `<Chips items={[answer]} />`, keeping `renderSampleAnswer`'s URL/file thumbnail+link handling for URL samples.
      Files: `apps/web/src/pages/FormReportsPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0.

- [ ] 27. Add a web unit test for `Chips` (design §3.5).
      New `apps/web/src/components/Chips.test.tsx`: renders N chips for N items, `—` for empty, coerces non-strings. (Also assert `formatResponseValue` stays comma-joined if easily importable.)
      Files: `apps/web/src/components/Chips.test.tsx`
      Verify: `cd apps/web && pnpm test` — new tests pass.

---

## Final integration verification

- [ ] 28. Full build + test sweep across both apps, then commit locally.
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` exits 0 AND `pnpm test` passes; `cd apps/web && pnpm exec tsc -b --noEmit` exits 0 AND `pnpm test` passes AND `pnpm build` (`tsc -b && vite build`) succeeds. Run the design's §2.11 manual checklist items that are feasible. Commit all changes locally on the current branch with a descriptive message. NO push, NO PR.

## Open assumptions
- No Prisma migration is introduced (theme + editing settings live in `schema` JSON; `editedAt` in `metadata` JSON; token is stateless). If any step reveals a schema-level need, stop and flag rather than adding a migration.
- Vitest is added to `apps/api` as a dev dependency only; if `pnpm install` is constrained in the environment, the pure-function tests still define the intended coverage and the implementer should note the blocker.
