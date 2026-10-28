# Design: Custom form templates (save-as-template)

## Overview

Qivo already serves a hardcoded list of built-in templates (`TEMPLATES` in `apps/api/src/modules/forms/templates.ts`) through `GET /api/forms/templates`, and creates forms from them via `POST /api/forms/from-template`. This feature adds **workspace-scoped custom templates**: any form can be saved as a reusable template that captures a **snapshot** of the form's current schema. Custom templates appear in the same picker (`CreateFormPage`) alongside built-ins, can be used to create new forms, and can be listed and deleted.

The design introduces one new Prisma model (`FormTemplate`), one hand-authored SQL migration, new service functions **added to the existing `form.service.ts`** (not a separate module — see "Service placement"), three new routes plus a reworked `GET /templates` and `POST /from-template`, and modest UI changes (a "Save as template" action on the dashboard form card, and grouped built-in/custom options plus a delete affordance in the picker).

The technology stack is locked to the existing one: **Express + Prisma (PostgreSQL)** on the API side, **React + Vite + TypeScript** on the web side, raw-SQL hand-authored migrations run by `prisma migrate deploy` on container boot, and the project's existing `api` fetch helper. No new libraries.

## Storage shape (Prisma model)

Add to `c:\Qivo\prisma\schema.prisma`:

```prisma
model FormTemplate {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  description String?
  category    String?
  schema      Json
  createdById String
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy User      @relation("FormTemplateCreator", fields: [createdById], references: [id])

  @@index([workspaceId])
  @@index([createdById])
}
```

Back-relations (required by Prisma; add the named relation on both sides):

- On `model Workspace`: add `templates FormTemplate[]` next to the existing `forms Form[]`.
- On `model User`: add `formTemplates FormTemplate[] @relation("FormTemplateCreator")` next to the existing `forms Form[]`.

Field rationale:
- `schema Json` holds a **full snapshot of `Form.schema`** — same shape produced by `getFormSchema()` (`{ version, sections[], settings, confirmationMessage? }`). Storing the whole object (not just sections) keeps the snapshot self-describing and lets the instantiation path reuse `getFormSchema()` to normalize it. Settings are copied as-is; see "Edge cases" for how transient settings are handled at instantiation.
- `createdById` uses `onDelete` default (**RESTRICT**) mirroring `Form.ownerId` (which also has no cascade) — deleting a user should not silently drop workspace templates; it is blocked, consistent with forms.
- `workspaceId` cascades on workspace delete, mirroring `Form.workspaceId`.
- No `updatedAt`: templates are immutable snapshots. The only mutation is delete. (Editing a template is explicitly out of scope — re-save to make a new one.)

### Migration

Create `c:\Qivo\prisma\migrations\20260928000000_add_form_template\migration.sql`. The `20260928000000` prefix follows the existing convention (latest is `20260927000000_...`; use the next day, zero-padded time). Content, matching the style of `20260926000100_add_form_share/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "FormTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "schema" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "FormTemplate_workspaceId_idx" ON "FormTemplate"("workspaceId");
CREATE INDEX "FormTemplate_createdById_idx" ON "FormTemplate"("createdById");

-- Foreign keys
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

After editing the schema, regenerate the client from the repo root: `npx prisma generate` (schema resolved via `prisma.config.ts`; generated client lands in `apps/api/src/generated/prisma`, gitignored). Do **not** run `prisma migrate dev` (it would try to author its own migration); the hand-written SQL above is the source of truth and `prisma migrate deploy` applies it on boot.

## Snapshot semantics (confirmed: SNAPSHOT, not live)

At save time the service deep-copies the source form's schema JSON into `FormTemplate.schema` via the existing `toPrismaJson(getFormSchema(form.schema))` round-trip (same pattern `duplicateForm` uses). The template is **independent thereafter** — later edits to the source form, or deleting the source form, do not change the template. Likewise, creating a form from a template copies the snapshot forward; later template deletion does not affect forms already created from it.

## Template id namespace and disambiguation

Built-in ids are human-readable strings (`"student-feedback"`, `"event-registration"`, ...). Custom ids are cuids (e.g. `"clx..."`). To make collisions impossible and keep the wire format unchanged, custom templates are exposed with a **`custom:` prefix** on their id in all API responses and in the picker: a custom template with DB id `clx123` is surfaced as `"custom:clx123"`.

### Service placement (pinned)

All new service functions — `saveFormAsTemplate`, `createFormFromCustomTemplate`, `listTemplatesForWorkspace`, `deleteTemplate`, and the pure `rebuildSchemaWithFreshIds` helper — live in the existing **`apps/api/src/modules/forms/form.service.ts`**. There is **no** new `template.service.ts`. Rationale (verified): the helpers these functions must reuse — `getFormSchema`, `toPrismaJson`, `createSectionId`, `createQuestionId`, `createFormSlug`, `getEditableForm`, `getMembership` — are all **private/un-exported** in `form.service.ts` (a grep for their `export` returns nothing). Colocating avoids widening those helpers' visibility and keeps the id-namespace add/strip logic in the same module as the resolution path. The route file holds only thin glue; the web layer gets no new TS service.

### Create-from-template resolution

Resolution in the create-from-template path is therefore unambiguous and order-independent:

1. If `templateId` starts with `"custom:"`, strip the prefix and treat the remainder as a `FormTemplate.id`. Look it up **scoped to the target workspace** (`where: { id, workspaceId }`) after confirming the caller is a member of that workspace. This authorizes the workspace on lookup — a user cannot instantiate another workspace's template because the row won't be found under their `workspaceId`.
2. Otherwise, treat `templateId` as a built-in and match against `TEMPLATES` by string id.

Because the prefix partitions the namespace, a custom id can never match a built-in and vice versa. The `custom:` string is chosen because cuids never contain a colon and no built-in id contains one, so stripping the first `"custom:"` is safe. (`"custom:"` is also a clear, greppable marker for the UI.)

## API surface

All new/changed handlers live in `apps/api/src/modules/forms/form.routes.ts`; business logic (new service functions) lives in `apps/api/src/modules/forms/form.service.ts` (see "Service placement" below for why). Error-name-to-HTTP mapping goes through the existing central error middleware in `apps/api/src/app.ts` (same `FORM_NOT_FOUND`/`FORBIDDEN`/`WORKSPACE_NOT_FOUND` names already used across `form.service.ts`).

**New error name `TEMPLATE_NOT_FOUND` must be registered in the middleware.** Verified against `apps/api/src/app.ts`: the `errorHandler` switch has cases for `WORKSPACE_NOT_FOUND`, `FORM_NOT_FOUND`, `FORBIDDEN`, `QUESTION_NOT_FOUND`, etc., but **no** case for `TEMPLATE_NOT_FOUND`; the `default` branch returns `500 INTERNAL_SERVER_ERROR`. The service functions in this feature *throw* a `TEMPLATE_NOT_FOUND` error (unlike the current inline `POST /from-template` handler, which returns `404` inline with `res.status(404).json(...)` and so never relies on the middleware). To make every "template not found" path return 404 as designed, add a case to the switch in `app.ts`, next to the existing `QUESTION_NOT_FOUND` case:

```ts
case "TEMPLATE_NOT_FOUND":
  res.status(404).json({
    success: false,
    error: { code: "TEMPLATE_NOT_FOUND", message: error.message },
  });
  return;
```

`app.ts` is therefore in the "Files to modify" list below. Define a `templateNotFoundError(message)` helper beside the existing `*Error` factories in `form.service.ts` (matching e.g. `formNotFoundError`) so the thrown error carries `name === "TEMPLATE_NOT_FOUND"`.

### 1. `GET /api/forms/templates` — now workspace-aware (auth required)

Currently unauthenticated and returns only built-ins. Reworked to **require auth** and accept a `workspaceId` query param:

- `requireAuth` middleware (same as the other routes).
- Validate `workspaceId` is a non-empty string (`400 INVALID_WORKSPACE_ID` otherwise), mirroring `GET /api/forms`.
- Call `listTemplatesForWorkspace(workspaceId, userId)` which: verifies membership (`getMembership`; `WORKSPACE_NOT_FOUND` -> 404 if not a member — any role may list), then returns built-ins mapped as today **plus** the workspace's custom templates:

```jsonc
{
  "success": true,
  "data": {
    "templates": [
      { "id": "student-feedback", "name": "...", "description": "...", "category": "...", "questionCount": 7, "custom": false },
      { "id": "custom:clx123", "name": "...", "description": "...", "category": "...", "questionCount": 5, "custom": true }
    ]
  }
}
```

`custom: true/false` lets the UI group/label. Built-ins listed first, then custom ordered by `createdAt desc`. (`questionCount` semantics are pinned in the breaking-change note below.)

`questionCount` counts **every** question across **all** sections of the snapshot (including questions behind jump rules or conditional visibility), which matches the built-in computation `t.questions.length` (a flat list, verified in `templates.ts`). The two template kinds are therefore counted identically and the UI label is consistent.

Breaking-change note: the old call was unauthenticated and param-less. A repo-wide search for `forms/templates` confirms **`CreateFormPage.tsx` is the only caller** of `GET /api/forms/templates` (the single match is its `api.get(... "/api/forms/templates")` in the initial `Promise.all`). It is updated in lockstep to pass `?workspaceId=<id>`. The authenticated `api.get` helper already attaches a **Bearer `Authorization` header** (sourced from the in-memory/localStorage token in `apps/web/src/lib/api.ts`); it does **not** use a cookie and does **not** set `credentials: "include"`, so no cookie handling must be added. This breaking change is safe because the picker always runs for a logged-in user with a selected workspace — provided the fetch is **guarded** so it does not fire until `workspaceId` is a non-empty string (see Web changes); sending `workspaceId=` would otherwise return `400 INVALID_WORKSPACE_ID`.

### 2. `POST /api/forms/:formId/save-as-template` (auth; edit rights on source form)

Body (new Zod schema `saveAsTemplateSchema` in `form.schemas.ts`):
- `name` — `z.string().trim().min(2).max(200)`. Required at the API boundary; the **UI** defaults it to the form title, but the server does not silently fall back (keeps validation explicit).
- `description` — `z.string().trim().max(2000).optional()`.
- `category` — `z.string().trim().max(100).optional()`.

Handler calls `saveFormAsTemplate(formId, userId, input)`:
- Loads the source form with `getEditableForm(formId, userId)` — this already enforces non-VIEWER workspace membership **or** a per-form EDITOR share, and throws `FORM_NOT_FOUND` otherwise. Reusing it keeps authorization identical to duplicate/edit.
- Builds the snapshot: `toPrismaJson(getFormSchema(form.schema))`.
- Creates the `FormTemplate` with `workspaceId = form.workspaceId`, `createdById = userId`.
- Returns `201` with `{ template: { id: "custom:<cuid>", name, description, category, questionCount, custom: true } }`.
- Fire-and-forget `logAction({ action: "TEMPLATE_CREATED", entityType: "form_template", entityId: template.id, ... })`, matching the existing `void logAction(...).catch(...)` pattern (audit is best-effort, never blocks the response).

### Route registration order (required — Express matches in registration order)

The router already declares `DELETE /:formId` and `GET /:formId` (verified in `form.routes.ts`). Express matches routes in the order they are registered, so the literal-segment template routes **must be registered before** the parameterized ones, otherwise `DELETE /api/forms/templates/clx123` matches `DELETE /:formId` with `formId = "templates"` and hits `deleteForm` (soft-deleting / 404ing on a phantom form) instead of the template handler.

- `GET /templates` is already the first `/templates`-prefixed route in the file and precedes `GET /:formId` (verified). The reworked `GET /templates` **keeps its leading position** — do not move it below `GET /:formId`.
- `DELETE /api/forms/templates/:id` **must be registered before `DELETE /:formId`** (and before `GET /:formId`). Place the new `DELETE /templates/:id` immediately after the `GET /templates` block, near the top of the router, so the literal `templates` segment is never captured by `:formId`.
- `POST /:formId/save-as-template` has a non-colliding static suffix (`save-as-template`) and sits under the `:formId` segment like the existing `POST /:formId/duplicate`, so its position among the other `/:formId/*` routes is unconstrained; register it next to `POST /:formId/duplicate` for cohesion.

### 3. `DELETE /api/forms/templates/:id` (auth; non-VIEWER in template's workspace)

- `id` is the **custom** id (with or without the `custom:` prefix — the handler strips it if present). Built-in ids never reach a `FormTemplate` row, so attempting to delete `"student-feedback"` yields `404 TEMPLATE_NOT_FOUND` (built-ins are undeletable by construction, satisfying "refuse to delete built-ins").
- Calls `deleteTemplate(templateId, userId)`:
  - Fetch the template by id. If missing -> `TEMPLATE_NOT_FOUND` (404).
  - Check `getMembership(template.workspaceId, userId)`; if not a member -> 404 (don't reveal existence across workspaces). If member but `role === "VIEWER"` -> `FORBIDDEN` (403).
  - `prisma.formTemplate.delete`.
- Returns `{ success: true, data: { message: "Template deleted." } }`.

### 4. `POST /api/forms/from-template` — teach it custom ids

Keep the existing route and its blank-vs-template behavior. Changes:
- After parsing `createFormSchema` (which already carries `workspaceId`, `title`, optional `description`) and reading `req.body.templateId`:
- Branch on the prefix:
  - **Built-in** (`!templateId.startsWith("custom:")`): unchanged path — `TEMPLATES.find`, `createForm`, loop `createQuestion`. (Left as-is so built-ins keep working exactly.)
  - **Custom** (`templateId.startsWith("custom:")`): call a new `createFormFromCustomTemplate({ templateId: stripped, workspaceId, ownerId: userId, title, description })`. This:
    - **Explicitly** checks `getMembership(workspaceId, userId)` and throws `forbiddenError(...)` if `role === "VIEWER"`. This guard is mandatory here: unlike the built-in branch, the custom path creates the form with `prisma.form.create` **directly** (to carry the snapshot schema) and never calls `createForm`, so it does **not** inherit `createForm`'s own VIEWER→`FORBIDDEN` rejection. The check must be performed in `createFormFromCustomTemplate` itself, using the same `FORBIDDEN` message `createForm` uses. (A non-member gets `WORKSPACE_NOT_FOUND`→404 from `getMembership`.)
    - Loads `FormTemplate` via `where: { id: strippedId, workspaceId }` (workspace-authorized lookup). If not found -> `TEMPLATE_NOT_FOUND` (404). This simultaneously prevents instantiating another workspace's template.
    - Rebuilds the form from the snapshot with **fresh ids** (see next section).
- Response shape unchanged: `201 { form }`.

## Instantiating a custom template with fresh ids (the snapshot copy)

Built-in instantiation loops `createQuestion`, which assigns fresh `question_<hex>` ids and drops everything into a single default section. Custom templates can have **multiple sections, section jump rules, and inter-question conditions**, so a naive per-question copy would lose sections and break id references. Instead, `createFormFromCustomTemplate` rebuilds the whole schema in one pass, remapping ids:

1. `const snapshot = getFormSchema(template.schema)`.
2. Build an id remap while cloning:
   - For each section: new id via `createSectionId()` (reuse the existing generator — `section_<hex>`), record `oldSectionId -> newSectionId`.
   - For each question: new id via `createQuestionId()` (`question_<hex>`), record `oldQuestionId -> newQuestionId`.
3. Rewrite references using the remaps:
   - Question `conditions[].questionId` -> remapped question id. If a referenced id isn't in the map (shouldn't happen in a self-consistent snapshot), drop that condition (defensive).
   - Section `jumpRules[].questionId` -> remapped question id (drop rule if unresolved).
   - Section `jumpRules[].target` -> remapped section id, **except** the sentinel `"__submit__"` (`JUMP_TARGET_SUBMIT`) which is preserved verbatim. If a target id isn't in the map, drop that rule (matches the engine's own "fall through to linear next" tolerance).
4. Create the form directly with `prisma.form.create` (not `createForm`, which forces an empty schema), setting: `workspaceId`, `ownerId = userId`, `title` (from request, user-provided), `description` (from request), `slug: createFormSlug(title)`, `status: "DRAFT"`, `schema: toPrismaJson(rebuiltSchema)`. Responses are **not** copied (none exist to copy — we copy a template, not a form).
5. `void logAction({ action: "FORM_CREATED", ... })` as `createForm` does.

Because step 4 uses `prisma.form.create` directly rather than `createForm`, it does **not** inherit `createForm`'s VIEWER rejection. `createFormFromCustomTemplate` must therefore perform its **own** `getMembership` + `role === "VIEWER"` → `throw forbiddenError(...)` check (same message `createForm` uses) *before* building and persisting the form. This is the single authoritative VIEWER gate for the custom create path.

Settings carried in the snapshot: `collectEmail`, `allowMultipleResponses`, `quizMode`, `showScore`, `theme`, `responseNotification`, `sendConfirmationEmail`, `responseEditing`, `responseEditMinutes` are all copied forward (a template should reproduce the form's behavior). `scheduledPublishAt`/`scheduledCloseAt` are **cleared** on instantiation (they are time-bound to the original form and meaningless on a fresh draft) — `createFormFromCustomTemplate` omits them from the rebuilt settings. This is the one deliberate deviation from a byte-for-byte copy; documented here so it isn't mistaken for a bug.

## Authorization summary (pinned)

| Operation | Gate | Reused primitive |
|---|---|---|
| List templates (picker) | workspace membership, **any role** | `getMembership` (404 if not a member) |
| Save as template | edit rights on source form (non-VIEWER member OR EDITOR share) | `getEditableForm` |
| Create form from custom template | membership on target workspace + non-VIEWER (to own the new form) | explicit `getMembership` + VIEWER check inside `createFormFromCustomTemplate` (the custom path does **not** call `createForm`, so it must enforce its own gate) |
| Delete template | non-VIEWER member of the **template's** workspace | `getMembership` + VIEWER check |

Cross-workspace isolation for create/delete is enforced by scoping every `FormTemplate` lookup to a `workspaceId` the caller is a verified member of (create) or by re-checking membership against `template.workspaceId` (delete).

## Web (frontend) changes

### CreateFormPage (`apps/web/src/pages/CreateFormPage.tsx`)
- `TemplateInfo` type gains `custom: boolean`.
- The `GET /api/forms/templates` call becomes workspace-aware and must move **out of the initial `Promise.all`**. Today that `Promise.all` fetches workspaces and templates together, but `workspaceId` is only resolved *after* the workspaces response arrives (from the PERSONAL/first workspace). Sending the templates request there would pass an empty `workspaceId`. Fix: fetch only workspaces in the initial load (resolving `workspaceId`), then fetch templates in a **separate `useEffect` keyed on `workspaceId`** that calls `/api/forms/templates?workspaceId=<id>`. This keeps the custom list correct when the user switches workspace in the multi-workspace selector.
- **Guard the templates fetch**: the effect must `return` early (skip the request) when `workspaceId === ""` / falsy, so no request fires before a workspace is selected. Without the guard, a first-render empty `workspaceId` would send `workspaceId=` and get `400 INVALID_WORKSPACE_ID`. Use `encodeURIComponent(workspaceId)` in the query string (matching the existing `/api/events?workspaceId=...` and `/api/forms/${id}/...` call sites on `DashboardPage`).
- Render the `<select>` as two `<optgroup>`s — "Templates" (built-ins, `custom === false`) and "Your workspace templates" (`custom === true`) — so built-in vs custom is visually distinct. Each option value is the template `id` (already prefixed for custom), passed straight to `from-template` as `templateId`; no client-side disambiguation needed.
- Delete affordance: since a native `<select>` can't host buttons, render a lightweight list **below** the picker showing only the workspace's custom templates, each with a small "Delete" button calling `DELETE /api/forms/templates/:id`. On success, remove it from local state and reset `selectedTemplate` if it pointed at the deleted one. This is the "management surface" — minimal but reachable, matching the confirmed "management UI can be lightweight" scope.

### DashboardPage (`apps/web/src/pages/DashboardPage.tsx`)
- Add a **"Save as template"** button to each form card's action row, right next to the existing "Duplicate" button (same `secondary-button compact` styling). This is the pinned trigger location — the dashboard already has per-form actions and the duplicate handler, so it's the natural home and avoids touching the form editor.
- Clicking prompts for a template name (default = form title; a simple `window.prompt` is acceptable for this lightweight surface) and POSTs `/api/forms/:formId/save-as-template`. No navigation.
- **Feedback mechanism (pinned):** the existing `duplicateForm` handler on this page swallows errors silently (`catch { /* silent */ }`, verified). Save-as-template deliberately diverges to give the user confirmation, because unlike duplicate (which inserts a visible new card) a successful save produces **no visible change on the dashboard**, so silent success would look like nothing happened. Reuse the page's existing `error` state (`setError`, the same banner `moveForm`/load use): on failure call `setError(err instanceof ApiRequestError ? err.message : "Unable to save template.")`; on success set a transient success line via the same banner area (either a dedicated `setNotice`-style string state cleared after a few seconds, or reuse `setError("")` plus a short-lived success message state — pick a single string state, e.g. `templateNotice`, rendered next to the existing error banner). Do **not** invent a new toast system. The prompt being cancelled (null) is a no-op (no request, no message).

### Types (`apps/web/src/types.ts`)
- Add a `TemplateInfo`/`CustomTemplate` type if templates are typed centrally; otherwise keep the local type in `CreateFormPage`. (Current code defines `TemplateInfo` locally — extend that in place.)

## Error handling (per operation)

- **Save as template**: source form not found / not editable -> `getEditableForm` throws `FORM_NOT_FOUND` -> 404 (fatal to the request, recoverable by the user picking a form they can edit). Invalid body (short name) -> Zod -> 400 `VALIDATION_ERROR`. DB write failure -> propagates to error middleware -> 500, logged by middleware. Audit log failure -> swallowed (`.catch` logs to console), never fails the request.
- **List templates**: not a member -> `WORKSPACE_NOT_FOUND` -> 404. Missing `workspaceId` -> 400. A malformed custom `schema` row (corrupt JSON) -> `getFormSchema` tolerates it (defaults version/sections/settings), so `questionCount` degrades to 0 rather than throwing; the row still lists. Logged at debug only; not fatal.
- **Create from custom template**: template not found in caller's workspace -> `TEMPLATE_NOT_FOUND` -> 404 (covers both "deleted" and "wrong workspace"). VIEWER -> `FORBIDDEN` -> 403. Snapshot with unresolved jump/condition references -> references dropped silently (defensive, matches engine tolerance), form still created. DB failure -> 500.
- **Delete template**: not found -> 404. Member but VIEWER -> 403. Not a member -> 404 (no cross-workspace existence leak). DB failure -> 500.

Validation rules for each external input:
- `workspaceId` (query/body): required, non-empty string, else 400.
- `templateId` (from-template body): required string, else 400 `INVALID_TEMPLATE`; prefix determines resolution; unresolved -> 404.
- `name`: required, trimmed, 2–200 chars.
- `description`: optional, trimmed, ≤2000.
- `category`: optional, trimmed, ≤100.
- `:id` path param (delete): required string; `custom:` prefix stripped if present.

## Invariants and ownership

- **Namespace partition** (custom ids are prefixed): owned by the API serialization layer (every place that emits a template id adds `custom:`) and the resolution layer (`from-template`/`delete` strip it). Both halves live in `form.service.ts` so they can't drift.
- **Snapshot immutability**: owned by the write path (copy-on-save, copy-on-instantiate). No endpoint updates `FormTemplate.schema`, so immutability holds by absence of a mutator.
- **Workspace isolation**: owned by the service layer, enforced by scoping every lookup to a verified-member `workspaceId`. The DB layer backs this with the FK + cascade but does not itself authorize reads, so the service must.

## Testability

- **Unit (pure, no DB)**: the id-remap/snapshot-rebuild function. Extract it as a pure helper `rebuildSchemaWithFreshIds(snapshot): FormSchema` in `form.service.ts` taking a schema and returning a remapped schema. Assert: all section/question ids are fresh and unique; `conditions[].questionId` and `jumpRules[].questionId`/`target` are remapped; `__submit__` preserved; unresolved references dropped. The `custom:` prefix add/strip helpers are also trivially unit-testable.
- **Integration (DB)**: save-as-template creates a row scoped to the form's workspace; list merges built-in + custom with correct `custom` flags and `questionCount`; from-template with a `custom:` id produces a DRAFT form owned by the caller with fresh ids and no responses; cross-workspace instantiation/delete is rejected; VIEWER is blocked from save/create/delete; deleting a built-in id 404s. These follow the existing API integration test style in the forms module.

Extracting the remap as a pure function is what keeps the hardest logic (id remapping + reference rewriting) out of the DB path and cheaply unit-testable; if it were inlined in the Prisma call it would only be reachable via integration tests.

## Files to create / modify

Create:
- `prisma/migrations/20260928000000_add_form_template/migration.sql`

Modify:
- `prisma/schema.prisma` — `FormTemplate` model + back-relations on `Workspace` and `User`.
- `apps/api/src/app.ts` — add the `case "TEMPLATE_NOT_FOUND"` (→404) to the `errorHandler` switch (see "API surface", finding on error mapping).
- `apps/api/src/modules/forms/form.routes.ts` — rework `GET /templates`, add `POST /:formId/save-as-template`, `DELETE /templates/:id`, teach `POST /from-template` custom ids. Observe the route-ordering rule (literal `templates` routes before `:formId` routes).
- `apps/api/src/modules/forms/form.schemas.ts` — `saveAsTemplateSchema`.
- `apps/api/src/modules/forms/form.service.ts` — **all** new service functions (`saveFormAsTemplate`, `createFormFromCustomTemplate`, `listTemplatesForWorkspace`, `deleteTemplate`) plus the pure `rebuildSchemaWithFreshIds` helper and a `templateNotFoundError` factory. They live here (not a separate module) to reuse the already-local `getFormSchema`, `toPrismaJson`, `createSectionId`, `createQuestionId`, `createFormSlug`, `getEditableForm`, `getMembership` without widening their visibility. No `template.service.ts` is created.
- `apps/web/src/pages/CreateFormPage.tsx` — workspace-aware fetch (guarded on non-empty `workspaceId`), optgroups, delete list.
- `apps/web/src/pages/DashboardPage.tsx` — "Save as template" action.
- `apps/web/src/types.ts` — template type `custom` flag (if typed centrally).

## Out of scope

- Editing an existing template (snapshots are immutable; re-save instead).
- Sharing templates across workspaces or a global/org template library.
- Copying responses, versions, or shares into templates or into forms created from them.
- Touching `duplicateForm` or the duplicate button (already works).

## Responses to design review findings

The review (`design-review.md`, verdict `CHANGES_REQUESTED`: 2 HIGH, 3 MEDIUM, 3 NIT) was addressed as follows. Every finding is resolved in-document; none is backlogged or ignored.

1. **HIGH — `TEMPLATE_NOT_FOUND` returns 500, not 404.** Addressed. The "API surface" section now states the middleware has no `TEMPLATE_NOT_FOUND` case (defaults to 500) and pins the fix: add a `case "TEMPLATE_NOT_FOUND"` → 404 to the `errorHandler` switch in `apps/api/src/app.ts`, backed by a `templateNotFoundError` factory in `form.service.ts`. `app.ts` is added to "Files to modify".
2. **HIGH — route order: `DELETE /:formId` would shadow `DELETE /templates/:id`.** Addressed. A new "Route registration order" subsection pins that `DELETE /templates/:id` and the reworked `GET /templates` must be registered **before** the parameterized `DELETE /:formId` / `GET /:formId`, and places the new DELETE immediately after the `GET /templates` block. `POST /:formId/save-as-template` is noted as collision-free.
3. **MEDIUM — `template.service.ts` vs `form.service.ts` contradiction.** Addressed by choosing option (a): there is **no** `template.service.ts`. A new "Service placement" subsection pins all new service functions + the pure helper in `form.service.ts`, citing the verified un-exported helpers. The Overview, Testability, Invariants, and Files sections were updated to match; the file was removed from the "Create" list.
4. **MEDIUM — VIEWER gate justified by `createForm`, which the custom path doesn't call.** Addressed. The misleading parenthetical is removed from both the `POST /from-template` custom branch and the instantiation section. Both now state unambiguously that, because the custom path uses `prisma.form.create` directly, `createFormFromCustomTemplate` must perform its **own** `getMembership` + `role === "VIEWER"` → `forbiddenError` check before building. The authorization table row was updated too.
5. **MEDIUM — `GET /templates` breaking change: guard the fetch and confirm sole caller.** Addressed. A repo search confirmed `CreateFormPage.tsx` is the only caller (stated in the breaking-change note). The Web changes section now pins: move the templates fetch out of the initial `Promise.all` into a `useEffect` keyed on `workspaceId`, and **guard** it to skip when `workspaceId` is empty (avoiding the `400 INVALID_WORKSPACE_ID` first-render case), using `encodeURIComponent`.
6. **NIT — "api helper sends auth cookie/header" imprecise.** Addressed. Reworded to "Bearer `Authorization` header... not a cookie... does not set `credentials: 'include'`", matching `apps/web/src/lib/api.ts`.
7. **NIT — save-as-template feedback diverges from the silent dashboard pattern.** Addressed. The DashboardPage section now pins the exact mechanism: reuse the page's existing `error` banner state for failures and a single transient success-notice string state for success, explaining why save (unlike duplicate) needs visible confirmation. No new toast system.
8. **NIT — `questionCount` semantics for custom templates.** Addressed. The `GET /templates` response note now states `questionCount` counts every question across all sections (including those behind jump rules/conditions), matching the built-in flat `t.questions.length`.
