# Verification: Custom form templates

First iteration (no `review.json` present). Implemented per `design.md` / `plan.md`.

## Commands run and results

### Prisma (from repo root `c:\Qivo`)
- `pnpm exec prisma validate` → **OK** ("The schema at prisma\schema.prisma is valid 🚀").
- `pnpm exec prisma generate` → **succeeded** ("Generated Prisma Client (7.9.1) to .\apps\api\src\generated\prisma"). Generated client is gitignored; not committed.
- Migration folder created: `prisma/migrations/20260928000000_add_form_template/migration.sql` (prefix follows the convention — next day after the prior latest `20260927000000_add_form_last_digest_sent_at`). Raw SQL `CREATE TABLE "FormTemplate"` with `schema JSONB NOT NULL`, two indexes, FK to `Workspace` `ON DELETE CASCADE`, FK to `User` `ON DELETE RESTRICT`, matching the style of `20260926000100_add_form_share`.
- `schema.prisma`: new `FormTemplate` model + back-relations `templates FormTemplate[]` on `Workspace` and `formTemplates FormTemplate[] @relation("FormTemplateCreator")` on `User`.

### apps/api
- `pnpm exec tsc --project tsconfig.json --noEmit` → **exit 0**.
- `pnpm test` (vitest) → **green, 42 tests passing** (3 files). 11 new tests cover `rebuildSchemaWithFreshIds` (fresh/unique/prefixed ids, condition + jumpRule remap, `__submit__` preserved, unresolved refs dropped, no input mutation) and the `custom:` prefix helpers (round-trip add/strip, `isCustomTemplateId`).

### apps/web
- `pnpm exec tsc -b --noEmit` → **exit 0**.
- `pnpm build:web` (vite build) → **succeeded** ("✓ built in 7.53s").
- `pnpm test` (vitest) → **green, 43 tests passing** (4 files).

### Root
- `pnpm typecheck` (api + web `tsc --noEmit`, stricter base config with `noUncheckedIndexedAccess`) → **exit 0, no errors**.

### Lint note (not a required gate)
`pnpm lint` reports **7 errors, all pre-existing on the unmodified baseline** (verified via `git stash` → same 7 errors in `AdminPanelPage`, `FormEditorPage`, `PublicFormPage`, `ResponseDashboardPage`, `TeamPage`, and the pre-existing `loadDashboard` useEffect pattern in `DashboardPage`). This feature introduced **zero new lint errors**. Lint is not in the task's required verification list and the pre-existing issues are out of scope.

## End-to-end trace

**(a) Save-as-template creates a workspace-scoped FormTemplate with a schema snapshot.**
`POST /api/forms/:formId/save-as-template` (routes) → `saveFormAsTemplate(formId, userId, {name, description?, category?})` (service). It loads the source form via `getEditableForm` (edit-rights gate), snapshots `toPrismaJson(getFormSchema(form.schema))`, and `prisma.formTemplate.create` with `workspaceId = form.workspaceId`, `createdById = userId`. The snapshot is a deep JSON copy, so later edits to the source form do not affect the template (see d). Returns `201 { template: { id: "custom:<cuid>", ..., questionCount, custom: true } }`.

**(b) The picker lists built-ins + workspace custom templates, labeled.**
`GET /api/forms/templates?workspaceId=<id>` (now `requireAuth` + `workspaceId` validation) → `listTemplatesForWorkspace(workspaceId, userId)`. Verifies membership via `getMembership` (`null` → `WORKSPACE_NOT_FOUND` 404; any role may list). Returns built-ins (`custom: false`, raw string ids) followed by the workspace's `FormTemplate` rows ordered `createdAt desc` (`custom: true`, ids prefixed `custom:`). `questionCount` for both kinds counts every question across all sections (built-ins use the flat `t.questions.length`). `CreateFormPage` renders two `<optgroup>`s: "Templates" (built-ins) and "Your workspace templates" (custom). The templates fetch was moved out of the initial `Promise.all` into a `useEffect` keyed on `workspaceId`, guarded to skip when `workspaceId` is empty (avoids `400 INVALID_WORKSPACE_ID`), using `encodeURIComponent`.

**(c) Create-from-custom produces a new DRAFT with fresh ids/slug and the snapshot's sections/questions, owned by the creator.**
`POST /api/forms/from-template`: if `templateId` starts with `custom:`, it calls `createFormFromCustomTemplate({ templateId: stripped, workspaceId, ownerId: userId, title, description })`; otherwise the built-in `TEMPLATES.find` + `createForm` + loop path is unchanged. The custom path: (1) `getMembership` + explicit VIEWER check (its own gate, since it uses `prisma.form.create` directly and does not call `createForm`); (2) workspace-scoped lookup `findFirst({ where: { id, workspaceId } })` → `TEMPLATE_NOT_FOUND` if missing; (3) `rebuildSchemaWithFreshIds(getFormSchema(template.schema))` assigns fresh `section_<hex>`/`question_<hex>` ids and remaps `conditions[].questionId`, `jumpRules[].questionId`, and `jumpRules[].target` (preserving `__submit__`); (4) `prisma.form.create` with `status: "DRAFT"`, `ownerId = userId`, `slug: createFormSlug(title)`, carrying all settings except `scheduledPublishAt`/`scheduledCloseAt` (cleared — time-bound to the original). Responses are not copied (templates have none). Response shape unchanged: `201 { form }`.

**(d) Editing the source form later does NOT change the template.**
The template stores an independent deep JSON copy of the schema at save time (`toPrismaJson(getFormSchema(...))`). No endpoint mutates `FormTemplate.schema` (only create + delete exist), so immutability holds by absence of a mutator. Subsequent `PATCH`es to the source form's `schema` touch only the `Form` row.

**(e) A VIEWER cannot create/delete; a user cannot instantiate or delete another workspace's template.**
- Save-as-template: `getEditableForm` rejects VIEWERs (`FORM_NOT_FOUND`).
- Create-from-custom: explicit `getMembership` + `role === "VIEWER"` → `FORBIDDEN` before any write.
- Delete: `getMembership` on the template's own workspace; VIEWER → `FORBIDDEN`.
- Cross-workspace instantiation: lookup is scoped to the caller's `workspaceId`, so another workspace's template row is never found → `TEMPLATE_NOT_FOUND`.
- Cross-workspace delete: `deleteTemplate` re-checks `getMembership(template.workspaceId, userId)`; a non-member gets `TEMPLATE_NOT_FOUND` (no cross-workspace existence leak).

**(f) Deleting a custom template removes it from the picker and refuses on built-ins.**
`DELETE /api/forms/templates/:id` (registered before `DELETE /:formId` / `GET /:formId` so the literal `templates` segment isn't captured by `:formId`) → `deleteTemplate(id, userId)` strips an optional `custom:` prefix and `prisma.formTemplate.delete`s. Built-in ids (`student-feedback`, etc.) never match a `FormTemplate` row → `TEMPLATE_NOT_FOUND` 404 (built-ins undeletable by construction). The picker's delete list on `CreateFormPage` removes the template from local state on success and resets `selectedTemplate` if it pointed at the deleted id.

## Error middleware
Added `case "TEMPLATE_NOT_FOUND"` → 404 to the `errorHandler` switch in `apps/api/src/app.ts` (next to `QUESTION_NOT_FOUND`), backed by the `templateNotFoundError` factory in `form.service.ts`.
