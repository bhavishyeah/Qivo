# Design Review: Custom form templates (save-as-template)

Reviewed document: `c:\Qivo\.agents\tasks\custom-form-templates\design.md`
Repository: `c:\Qivo`
Reviewer stance: fresh read, no prior context; every "the code does X" claim was checked against source.

## Summary

This is a strong, unusually concrete design. It is a second-pass document that already absorbed a prior review (8 findings, `CHANGES_REQUESTED`) and the fixes hold up: the `TEMPLATE_NOT_FOUND` 500→404 gap, the Express route-ordering shadowing, the `template.service.ts`-vs-`form.service.ts` contradiction, the VIEWER-gate justification, and the `GET /templates` breaking-change guard are all addressed and match the actual code.

I verified the model shape, the migration convention, the built-in-vs-custom id disambiguation, the API surface and auth rules, the SNAPSHOT semantics, and the picker UX against the repository. The core technical claims are accurate. I found no HIGH or MEDIUM issues. A few NITs about wording precision remain; none blocks implementation.

Verdict: **APPROVED** (0 HIGH, 0 MEDIUM, 3 NIT).

## Findings

1. **NIT — "`getMembership` (404 if not a member)" wording could mislead on who throws.**
   Location: "Authorization summary" table (List templates row) and the `listTemplatesForWorkspace` description under `GET /templates`.
   `getMembership` was verified to `return prisma.workspaceMember.findUnique(...)` — it returns `null` for a non-member and never throws (`form.service.ts`). The table's shorthand "`getMembership` (404 if not a member)" reads as if the primitive itself produces the 404. The `deleteTemplate` bullet gets this right ("Check `getMembership(...)`; if not a member -> 404"), and the design author clearly understands the pattern (`createForm` does `if (!membership) throw WORKSPACE_NOT_FOUND`). Still, for a fresh implementer the table is slightly misleading.
   Concrete fix: in `listTemplatesForWorkspace`, state explicitly: "call `getMembership(workspaceId, userId)`; if it returns `null`, throw a `WORKSPACE_NOT_FOUND` error (the service translates the null, mirroring `createForm`)." Leave the table but footnote that the 404 is raised by the caller, not by `getMembership`.

2. **NIT — custom-template create path drops `folderId`, unlike `duplicateForm`, without calling it out.**
   Location: "Instantiating a custom template with fresh ids", step 4 (the `prisma.form.create` field list).
   Verified: `duplicateForm` copies `folderId: form.folderId` into the new form (`form.service.ts`), and `Form.folderId` is a nullable column with `onDelete: SetNull` (`schema.prisma`). A form created from a template has no source form, so there is genuinely no folder to copy — leaving `folderId` unset (null) is correct. The design lists the fields it sets (`workspaceId`, `ownerId`, `title`, `description`, `slug`, `status`, `schema`) and omits `folderId` silently. That is the right behavior but is left implicit.
   Concrete fix: add one line to step 4: "`folderId` is intentionally left null — a template has no source folder; the user can file the new form afterward. (This differs from `duplicateForm`, which copies the source's `folderId`.)"

3. **NIT — `questionCount` degrade-to-0 on corrupt custom schema is specified for list but not surfaced in the UI note.**
   Location: "Error handling (per operation)", List templates bullet; and `GET /templates` response note.
   Verified: `getFormSchema` tolerates malformed input (defaults `version`/`sections`/`settings`), so a corrupt `schema` row yields `sections: []` and thus `questionCount: 0` rather than throwing — the design's claim is accurate. The design says the row "still lists." That is a sensible choice, but the picker renders `({t.questionCount} questions)` in each option label, so a corrupted template would display "(0 questions)" with no hint it is broken.
   Concrete fix: note in the Web changes section that a custom template surfacing `questionCount: 0` is rendered normally (acceptable for this lightweight surface); no special "corrupt" affordance is required. This is a one-sentence acknowledgement so the implementer does not treat the 0 as a bug to defend against.

## Verified Assumptions

Each item below was claimed by the design and confirmed against source.

- **Built-in templates are human-readable string ids; `questionCount` is a flat count.** `TEMPLATES` in `apps/api/src/modules/forms/templates.ts` has ids like `student-feedback`, `event-registration`; the existing route emits `questionCount: t.questions.length` over a flat `questions[]`. The `custom:` prefix cannot collide with these (no built-in id contains a colon). Confirmed.
- **`GET /api/forms/templates` is currently unauthenticated, param-less, and returns only built-ins.** Confirmed in `form.routes.ts` (`formRouter.get("/templates", (_req, res) => {...})`, no `requireAuth`).
- **`CreateFormPage.tsx` is the sole caller of `GET /api/forms/templates`, and fetches it inside the initial `Promise.all` alongside `/api/workspaces`.** Confirmed; `workspaceId` is resolved only *after* that response, so the design's fix (move templates fetch into a `useEffect` keyed on `workspaceId`, guarded against empty) is both correct and necessary.
- **`POST /from-template` currently returns 404 inline (`res.status(404).json(...)`), not via middleware, and reads `req.body.templateId` separately from `createFormSchema`.** Confirmed in `form.routes.ts`. `createFormSchema` carries `{ workspaceId, title, description? }` and does not include `templateId` (`form.schemas.ts`). Confirmed.
- **The `errorHandler` switch in `app.ts` has cases for `WORKSPACE_NOT_FOUND`, `FORM_NOT_FOUND`, `FORBIDDEN`, `QUESTION_NOT_FOUND`, etc., but NO `TEMPLATE_NOT_FOUND` case; `default` returns 500.** Confirmed. The design's fix (add a `case "TEMPLATE_NOT_FOUND"` → 404 plus a `templateNotFoundError` factory) is required and correct.
- **Express matches routes in registration order; `DELETE /:formId` and `GET /:formId` are registered as parameterized routes, and `GET /templates` is registered first.** Confirmed in `form.routes.ts`. The route-ordering rule (literal `templates` routes before `:formId`) is real and the `DELETE /templates/:id` shadowing risk is genuine. `POST /:formId/duplicate` exists and is the stated sibling for `POST /:formId/save-as-template`.
- **Service helpers are un-exported.** `getFormSchema`, `toPrismaJson`, `createSectionId`, `createQuestionId`, `createFormSlug`, `getEditableForm`, `getMembership` are all declared as `function`/`async function` with no `export` (grep for `export (async )?function` returns only `createForm`, `createQuestion`, `duplicateForm`, etc.). The "Service placement" rationale (colocate in `form.service.ts` to avoid widening visibility) is factually grounded. Confirmed.
- **`getEditableForm` enforces non-VIEWER workspace membership OR a per-form EDITOR share and throws `FORM_NOT_FOUND`.** Confirmed — the workspace query filters `role: { not: "VIEWER" }`, then falls back to `hasEditorShare`, else throws `formNotFoundError("Form not found or not editable.")`. Reusing it for save-as-template is correct.
- **`createForm` does `getMembership` → `WORKSPACE_NOT_FOUND` if null → `forbiddenError("You do not have permission to create forms.")` if VIEWER.** Confirmed. This is the message the custom-create path should reuse, and the design's claim that the custom path uses `prisma.form.create` directly (so it must re-implement this gate) is correct because `duplicateForm` is the only existing `prisma.form.create` caller and it relies on `getEditableForm` upstream.
- **SNAPSHOT via `toPrismaJson(getFormSchema(form.schema))` matches the `duplicateForm` pattern.** Confirmed — `duplicateForm` does exactly `const schema = getFormSchema(form.schema); ... schema: toPrismaJson(schema)`.
- **Schema shape and settings fields.** `getFormSchema` returns `{ version, sections, settings, confirmationMessage? }`. Settings include `collectEmail`, `allowMultipleResponses`, `scheduledPublishAt`, `scheduledCloseAt`, `quizMode`, `showScore`, `responseNotification`, `sendConfirmationEmail`, `theme`, `responseEditing`, `responseEditMinutes`. All settings the design copies forward exist; `scheduledPublishAt`/`scheduledCloseAt` are the two it clears. Confirmed.
- **`conditions[].questionId`, `SectionJumpRule { questionId, operator, value?, target }`, section `jumpRules?`, and the `__submit__` sentinel (`JUMP_TARGET_SUBMIT`).** All confirmed in `form.service.ts`. The remap plan (rewrite `conditions[].questionId`, `jumpRules[].questionId`, `jumpRules[].target` except `__submit__`, drop unresolved) matches the real types and the engine's forward-only, fall-through-on-unknown tolerance.
- **Migration convention.** `prisma/migrations` latest is `20260927000000_add_form_last_digest_sent_at`; `20260926000100_add_form_share` exists (the cited style example). `20260928000000_add_form_template` follows the next-day zero-padded convention. Confirmed.
- **Prisma relations anchors.** `User` has `forms Form[]` and `Workspace` has `forms Form[]` (`schema.prisma`), so the back-relations can be added as described. `Form.owner` has no `onDelete` (defaults RESTRICT) and `Form.workspace` is `onDelete: Cascade` — the design's RESTRICT-for-`createdById` / Cascade-for-`workspaceId` rationale is accurate.
- **`api` helper semantics.** `apps/web/src/lib/api.ts` attaches `Authorization: Bearer <token>`, does NOT set `credentials: "include"`, and uses no cookie. `api.delete<T>(path)` and `api.get<T>(path)` exist. The NIT-6 rewording from the prior review is accurate. Query params must be built inline (the helper takes no params arg), matching the design's `encodeURIComponent` instruction.
- **DashboardPage patterns.** `duplicateForm` handler exists with `catch { /* silent */ }`; `error`/`setError` state exists and is used by `moveForm`/load; the Duplicate button uses `secondary-button compact`. The design's feedback mechanism, button placement, and "diverge from silent" rationale are all grounded in the actual file.
- **`GET /api/forms` validation mirror.** The existing `GET /` checks `typeof workspaceId !== "string"` → `400 INVALID_WORKSPACE_ID`; the design reuses the same code/shape for `GET /templates`. Confirmed.

## Unverified / Wrong Assumptions

No wrong assumptions were found. Every factual claim in the design that was checkable against the repository checked out.

Items not independently verified (out of reach for a static review, not defects):

- **Runtime route-match behavior.** The route-ordering reasoning is correct in principle (Express is order-sensitive) and the registration positions are specified; actual match behavior would only be confirmed by running the server, which is out of scope for this review.
- **`prisma generate` client accessor name.** The design assumes the `FormTemplate` model yields `prisma.formTemplate`. That follows Prisma's standard camelCase convention and is consistent with existing accessors (`prisma.formVersion`, `prisma.workspaceMember`), but the generated client was not inspected (it is gitignored under `apps/api/src/generated/prisma`).
- **`logAction` signature.** The design reuses `void logAction({...}).catch(...)` with new `action`/`entityType` values (`TEMPLATE_CREATED`, `form_template`). The pattern matches existing usage seen in `createForm`, but whether `logAction` constrains `action`/`entityType` to an enum/union was not checked; if it does, those new literals may need to be added. Flagging as a thing to confirm at implementation time, not a design defect.

## Verdict

0 HIGH, 0 MEDIUM, 3 NIT. Per the mechanical rule (any HIGH or MEDIUM → CHANGES_REQUESTED; otherwise APPROVED), the verdict is **APPROVED**. The three NITs are wording/precision clarifications the implementer can fold in without a design round-trip.
