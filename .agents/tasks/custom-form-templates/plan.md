# Implementation Plan: Custom form templates (save-as-template)

Follows the approved design at `.agents/tasks/custom-form-templates/design.md` (verdict APPROVED). Do not re-decide architecture — this plan sequences the design's decisions.

Repo facts confirmed during exploration (ground truth for the steps below):
- Monorepo, pnpm workspaces (`apps/*`, `packages/*`). Prisma 7, schema at `prisma/schema.prisma`, config at repo-root `prisma.config.ts`, generated client lands in `apps/api/src/generated/prisma` (gitignored). Migrations are hand-authored raw SQL under `prisma/migrations/<ts>_<name>/migration.sql`; latest is `20260927000000_add_form_last_digest_sent_at`, so the next prefix is `20260928000000`.
- API: Express 5 + Prisma. Routes `apps/api/src/modules/forms/form.routes.ts`; service `apps/api/src/modules/forms/form.service.ts`; Zod schemas `apps/api/src/modules/forms/form.schemas.ts`; built-ins `apps/api/src/modules/forms/templates.ts`; central error middleware switch in `apps/api/src/app.ts`.
- Confirmed un-exported helpers in `form.service.ts` (keep new functions colocated to reuse them without widening visibility): `getFormSchema`, `toPrismaJson`, `createSectionId` (`section_<hex>`), `createQuestionId` (`question_<hex>`), `createFormSlug`, `getEditableForm`, `getMembership`, `formNotFoundError`, `forbiddenError`, and the `JUMP_TARGET_SUBMIT = "__submit__"` sentinel. There is NO `workspaceNotFoundError` factory — `createForm` throws `WORKSPACE_NOT_FOUND` inline (`new Error(...)` + `error.name = "WORKSPACE_NOT_FOUND"`); mirror that pattern.
- `app.ts` error switch currently has `WORKSPACE_NOT_FOUND`, `FORM_NOT_FOUND`, `SHARE_NOT_FOUND`, `FORBIDDEN`, `QUESTION_NOT_FOUND`, `INVALID_QUESTION_ORDER` cases; NO `TEMPLATE_NOT_FOUND` (falls through to 500).
- `getMembership` returns the `WorkspaceMember` row or `null` and never throws (verdict NIT 1) — callers must translate `null` to a thrown error.
- `logAction({ workspaceId, userId, action, entityType, entityId?, metadata? })` — fire-and-forget pattern is `void logAction({...}).catch((err) => console.error(...))`.
- Web: React + Vite + TS. `apps/web/src/lib/api.ts` `api` helper attaches a Bearer `Authorization` header (no cookies). `CreateFormPage.tsx` is the ONLY caller of `GET /api/forms/templates` (confirmed) and fetches it inside the initial `Promise.all` with workspaces. `DashboardPage.tsx` has a `duplicateForm` handler that swallows errors (`catch { /* silent */ }`) and a shared `error` banner via `setError`; the per-form action row uses `secondary-button compact` buttons ("Duplicate" at the relevant row).
- Test framework: Vitest in both apps (`apps/api` and `apps/web` each have `vitest.config.ts`; `apps/api` `test` script = `vitest run`). Existing `form.service.test.ts` tests EXPORTED pure functions with no DB — this is the pattern the new pure helper must follow.
- Build/typecheck commands (from root `package.json`): `pnpm typecheck` (runs `tsc --noEmit` for api then web), `pnpm build:api`, `pnpm build:web`, `pnpm lint` (web eslint). Per-app tests: `pnpm --filter api test` and `pnpm --filter web test`. Client regen: `pnpm db:generate` (= `prisma generate`).

Dependency order: data model (1-2) → generated client (3) → API error mapping + schema (4-5) → service functions (6-8) → routes (9) → web (10-12) → full verification (13). Each step leaves the repo buildable.

---

- [ ] 1. Add the `FormTemplate` model and its back-relations to the Prisma schema.
      Add the `FormTemplate` model exactly as specified in design.md "Storage shape": fields `id` (cuid), `workspaceId`, `name`, `description?`, `category?`, `schema Json`, `createdById`, `createdAt` (default now); relations `workspace Workspace @relation(... onDelete: Cascade)` and `createdBy User @relation("FormTemplateCreator", ...)` (default RESTRICT on user delete); `@@index([workspaceId])` and `@@index([createdById])`. Add the back-relation `templates FormTemplate[]` to `model Workspace` (next to `forms Form[]`) and `formTemplates FormTemplate[] @relation("FormTemplateCreator")` to `model User` (next to `forms Form[]`). No `updatedAt` (templates are immutable).
      Files: `prisma/schema.prisma`
      Verify: `pnpm exec prisma validate` from repo root — schema validates with no relation errors.

- [ ] 2. Hand-author the raw-SQL migration for `FormTemplate`.
      Create the migration directory and file with the SQL from design.md "Migration" verbatim (CreateTable with `schema JSONB NOT NULL`, two indexes `FormTemplate_workspaceId_idx` / `FormTemplate_createdById_idx`, FK to `Workspace` `ON DELETE CASCADE`, FK to `User` `ON DELETE RESTRICT`), matching the style of `prisma/migrations/20260926000100_add_form_share/migration.sql`. Do NOT run `prisma migrate dev`.
      Files: `prisma/migrations/20260928000000_add_form_template/migration.sql`
      Verify: directory sorts last under `prisma/migrations` (prefix `20260928000000` > `20260927000000`); SQL references only existing tables `Workspace`/`User` and column/constraint names match the model from step 1 (table `FormTemplate`, PK `FormTemplate_pkey`).

- [ ] 3. Regenerate the Prisma client so `prisma.formTemplate` is typed.
      Run client generation from repo root (schema resolved via `prisma.config.ts`).
      Files: none hand-edited (regenerates `apps/api/src/generated/prisma`, gitignored).
      Verify: `pnpm db:generate` completes successfully and `prisma.formTemplate` is available (confirmed transitively by the API typecheck in step 6+).

- [ ] 4. Register the `TEMPLATE_NOT_FOUND` error case in the central middleware.
      Add a `case "TEMPLATE_NOT_FOUND":` returning `404` with `{ success: false, error: { code: "TEMPLATE_NOT_FOUND", message: error.message } }` to the `errorHandler` switch, placed next to the existing `QUESTION_NOT_FOUND` case.
      Files: `apps/api/src/app.ts`
      Verify: `pnpm --filter api exec tsc --noEmit` — compiles clean.

- [ ] 5. Add the `saveAsTemplateSchema` Zod schema.
      Add `export const saveAsTemplateSchema = z.object({ name: z.string().trim().min(2).max(200), description: z.string().trim().max(2000).optional(), category: z.string().trim().max(100).optional() })` following the existing schema style in the file (e.g. `createFormSchema`).
      Files: `apps/api/src/modules/forms/form.schemas.ts`
      Verify: `pnpm --filter api exec tsc --noEmit` — compiles clean.

- [ ] 6. Add the pure `rebuildSchemaWithFreshIds` helper and a `templateNotFoundError` factory to `form.service.ts`, and EXPORT the helper.
      `templateNotFoundError(message = "Template not found.")` returns an `Error` with `name === "TEMPLATE_NOT_FOUND"`, mirroring `formNotFoundError`. `export function rebuildSchemaWithFreshIds(snapshot: FormSchema): FormSchema` clones the schema remapping every section id via `createSectionId()` and every question id via `createQuestionId()` (build old→new maps), then rewrites references per design "Instantiating a custom template with fresh ids": question `conditions[].questionId` → remapped (drop condition if unresolved); section `jumpRules[].questionId` → remapped (drop rule if unresolved); `jumpRules[].target` → remapped section id EXCEPT the `JUMP_TARGET_SUBMIT` sentinel which is preserved verbatim (drop rule if target unresolved). It must be exported so it is unit-testable like the existing exported pure functions (`validateSubmission`, `nextSectionAfter`, `computeReachedSections`).
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `pnpm --filter api exec tsc --noEmit` — compiles clean.

- [ ] 7. Add unit tests for `rebuildSchemaWithFreshIds` and the `custom:` prefix handling.
      Following the no-DB style of `form.service.test.ts`, assert: all section/question ids are fresh (`section_`/`question_` prefixed) and unique; `conditions[].questionId` and `jumpRules[].questionId`/`target` are remapped to the new ids; the `__submit__` target is preserved verbatim; unresolved references are dropped. If the `custom:` add/strip logic is factored into small exported helpers, cover them too (round-trip add→strip).
      Files: `apps/api/src/modules/forms/form.service.test.ts` (extend) or a sibling `*.test.ts` in the same dir.
      Verify: `pnpm --filter api test` — new tests pass, existing tests still pass.

- [ ] 8. Add the four DB-touching service functions to `form.service.ts`.
      Implement per design.md, all in `form.service.ts`, each `export async function`:
      - `saveFormAsTemplate(formId, userId, input)`: load via `getEditableForm(formId, userId)`; snapshot `toPrismaJson(getFormSchema(form.schema))`; `prisma.formTemplate.create` with `workspaceId: form.workspaceId`, `createdById: userId`; return `{ id: "custom:"+row.id, name, description, category, questionCount, custom: true }` where `questionCount` counts every question across all sections of the snapshot; fire-and-forget `logAction({ action: "TEMPLATE_CREATED", entityType: "form_template", entityId: row.id, workspaceId: form.workspaceId, userId, ... })`.
      - `listTemplatesForWorkspace(workspaceId, userId)`: call `getMembership`; if it returns `null`, throw a `WORKSPACE_NOT_FOUND` error (mirror the inline pattern in `createForm`; the 404 is raised by this caller, not by `getMembership` — verdict NIT 1). Any role may list. Return built-ins mapped as today with `custom: false`, then the workspace's `FormTemplate` rows ordered `createdAt desc` mapped with id `"custom:"+id`, `custom: true`, and `questionCount` = total questions across all snapshot sections. A corrupt snapshot degrades to `questionCount: 0` via `getFormSchema` tolerance and still lists.
      - `createFormFromCustomTemplate({ templateId, workspaceId, ownerId, title, description })`: FIRST call `getMembership(workspaceId, ownerId)` — `null` → throw `WORKSPACE_NOT_FOUND`; `role === "VIEWER"` → `throw forbiddenError(...)` using the SAME message `createForm` uses (this path uses `prisma.form.create` directly and does NOT inherit `createForm`'s VIEWER gate, so this explicit check is mandatory). Load `prisma.formTemplate.findFirst({ where: { id: templateId, workspaceId } })`; if missing → `throw templateNotFoundError()`. Build `rebuildSchemaWithFreshIds(getFormSchema(template.schema))`; copy forward all settings EXCEPT clear `scheduledPublishAt`/`scheduledCloseAt`. `prisma.form.create` with `workspaceId`, `ownerId`, `title`, `description`, `slug: createFormSlug(title)`, `status: "DRAFT"`, `schema: toPrismaJson(rebuiltSchema)`; leave `folderId` intentionally null (a template has no source folder — differs from `duplicateForm` which copies `folderId`; verdict NIT 2). Fire-and-forget `logAction({ action: "FORM_CREATED", ... })`. Return the created form.
      - `deleteTemplate(templateId, userId)`: strip a leading `custom:` if present; `prisma.formTemplate.findUnique`/`findFirst` by id; missing → `templateNotFoundError()`. `getMembership(template.workspaceId, userId)`: `null` → throw `TEMPLATE_NOT_FOUND` (no cross-workspace existence leak); `role === "VIEWER"` → `forbiddenError`. Then `prisma.formTemplate.delete`.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `pnpm --filter api exec tsc --noEmit` — compiles clean; `pnpm --filter api test` still passes.

- [ ] 9. Wire the routes in `form.routes.ts`, respecting Express registration order.
      Per design "Route registration order": (a) rework `GET /templates` to `requireAuth`, validate `workspaceId` query (non-empty string else `400 INVALID_WORKSPACE_ID`, mirroring `GET /`), and return `listTemplatesForWorkspace(workspaceId, userId)` — keep it in its existing leading position above `GET /:formId`; (b) add `DELETE /templates/:id` immediately after the `GET /templates` block (BEFORE `DELETE /:formId`/`GET /:formId` so the literal `templates` segment isn't captured by `:formId`), stripping an optional `custom:` prefix and calling `deleteTemplate`; (c) add `POST /:formId/save-as-template` next to `POST /:formId/duplicate`, parsing `saveAsTemplateSchema`, calling `saveFormAsTemplate`, returning `201 { template }`; (d) teach `POST /from-template`: after `createFormSchema.parse` and reading `templateId`, branch — if `templateId.startsWith("custom:")` call `createFormFromCustomTemplate({ templateId: stripped, workspaceId, ownerId: userId, title, description })` and return `201 { form }`; otherwise keep the existing built-in `TEMPLATES.find` + `createForm` + loop path unchanged. Import the new service functions and `saveAsTemplateSchema`. All handlers use `requireAuth` and the existing `req.user` guard + `next(error)` pattern.
      Files: `apps/api/src/modules/forms/form.routes.ts`
      Verify: `pnpm --filter api exec tsc --noEmit` — compiles clean. Manual sanity on ordering: in the file, `GET /templates` and `DELETE /templates/:id` appear before `GET /:formId` and `DELETE /:formId`.

- [ ] 10. Make the `CreateFormPage` templates fetch workspace-aware and add built-in/custom optgroups.
      Extend the local `TemplateInfo` type with `custom: boolean`. Remove the templates call from the initial `Promise.all` (that load only fetches workspaces and resolves `workspaceId`). Add a separate `useEffect` keyed on `workspaceId` that returns early when `workspaceId` is falsy/empty (guard against `400 INVALID_WORKSPACE_ID`) and otherwise `api.get(... "/api/forms/templates?workspaceId=" + encodeURIComponent(workspaceId))`. Render the `<select>` as two `<optgroup>`s — built-ins (`custom === false`) and "Your workspace templates" (`custom === true`); option value = template `id` (already `custom:`-prefixed for customs), passed straight through as `templateId`. A custom template with `questionCount: 0` renders normally (no special corrupt affordance — verdict NIT 3).
      Files: `apps/web/src/pages/CreateFormPage.tsx`
      Verify: `pnpm --filter web exec tsc --noEmit` and `pnpm lint` — clean.

- [ ] 11. Add a reachable delete affordance for custom templates on `CreateFormPage`.
      Below the picker, render a lightweight list of only the workspace's custom templates (`custom === true`), each with a small "Delete" button calling `DELETE /api/forms/templates/:id`. On success, remove it from local `templates` state and reset `selectedTemplate` if it pointed at the deleted id. Reuse the page's existing `error` state for failures (`setError(err instanceof ApiRequestError ? err.message : ...)`).
      Files: `apps/web/src/pages/CreateFormPage.tsx`
      Verify: `pnpm --filter web exec tsc --noEmit` and `pnpm lint` — clean.

- [ ] 12. Add the "Save as template" action to `DashboardPage` form cards.
      Add a `secondary-button compact` "Save as template" button in each form card's action row, next to "Duplicate". On click, `window.prompt` for a name (default = form title); if the user cancels (null) do nothing (no request, no message); otherwise POST `/api/forms/:formId/save-as-template` with `{ name, ... }` and no navigation. Feedback per design: reuse the existing `error` banner for failures (`setError`), and add a single transient success-notice string state (e.g. `templateNotice`, cleared after a few seconds) rendered next to the existing error banner — do NOT add a new toast system. (Save produces no visible card, unlike Duplicate, so success needs explicit confirmation.)
      Files: `apps/web/src/pages/DashboardPage.tsx`
      Verify: `pnpm --filter web exec tsc --noEmit` and `pnpm lint` — clean.

- [ ] 13. Full build + test gate across both apps.
      Run the project's typecheck, per-app test suites, and web build to confirm the feature integrates and nothing regressed.
      Files: none.
      Verify: `pnpm typecheck` (api + web `tsc --noEmit`) passes; `pnpm --filter api test` and `pnpm --filter web test` pass; `pnpm build:web` succeeds. (API DB integration tests from design "Testability" — save-as-template row scoping, merged list, from-template fresh-ids/no-responses, cross-workspace + VIEWER rejection, built-in-id 404 — are covered here if the existing forms module has a DB harness; if none exists, the exported-pure-function unit tests from step 7 plus typecheck are the enforced gate, matching the repo's current no-DB service test style.)

## Notes / assumptions
- `prisma validate` is used in step 1 because it does not require a database connection; `prisma generate` (step 3) likewise reads the schema via `prisma.config.ts`. `prisma migrate deploy` applies the hand-authored SQL on container boot — not run here.
- The repo has no `AGENTS.md`/`CONTRIBUTING.md`/`.kiro/steering` (searched); conventions were inferred directly from existing code (migration style, inline error-name throwing, fire-and-forget audit logging, exported-pure-function tests).
- `questionCount` for both built-in and custom templates counts a flat total across all sections, matching the built-in `t.questions.length`, so the picker label is consistent.
