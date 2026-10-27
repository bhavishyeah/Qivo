# Technical Design — Per-Form Sharing + Email Invites (FormShare)

## Overview

This feature adds two capabilities to Qivo on top of the existing "forms are always public" model: (a) emailing a form's link to specific people, and (b) granting per-**form** (not per-workspace) collaborator access. It introduces a new Prisma model `FormShare`, a new API module `formShares` plus a small `invites` surface, two new email templates, a signup→acceptance flow that carries an invite token, a new frontend acceptance page, and an extension of the existing `FormSharePage` with an invite card.

Nothing here gates form submission. Submission stays fully public and untouched. Per-form shares are **purely additive**: an `ACCEPTED` `FormShare` with role `EDITOR` grants edit access to that one form; `VIEWER` grants response-viewing access to that one form; `RESPONDER` grants no backend permission at all (its only effects are email delivery and showing the form in a future "shared with me" list). Per-form shares never remove, weaken, or override existing workspace-membership checks — they are an additional path to access, OR-ed with the workspace path.

The stack is locked to the existing one: **Node + Express + TypeScript (ESM, `.js` import specifiers)** on the API, **Prisma 7 + PostgreSQL** for data (client generated to `apps/api/src/generated/prisma`), **Resend** for email (with silent console no-op when `RESEND_API_KEY` is unset), and **React + React Router + Vite + TypeScript** on the web app. No new runtime dependencies are added.

---

## Technology stack (locked)

- API: Express router modules under `c:\Qivo\apps\api\src\modules\<name>\` with the `*.routes.ts` / `*.service.ts` / `*.schemas.ts` triplet, mirroring `members`.
- Validation: `zod` schemas, parsed in the route handler (`schema.parse(req.body)`), errors flow to the central `errorHandler` in `app.ts` via `next(error)`.
- Error signalling: throw a plain `Error` whose `.name` is a known code; `app.ts`'s `errorHandler` maps `.name` → HTTP status + envelope. New `.name` values must be added to that switch.
- Auth: `requireAuth` middleware (Bearer token from `localStorage`, also accepts cookie). `req.user = { id, name, email }`.
- CSRF: `csrfProtection` is mounted on `/api`. Bearer-authenticated requests are exempt; `GET/HEAD/OPTIONS` are exempt; paths containing `/public/` are exempt.
- DB: `prisma` singleton from `c:\Qivo\apps\api\src\db\prisma.js`.
- Email: `sendEmail(...)` in `c:\Qivo\apps\api\src\services\email.ts`; never throws, no-ops to console when unconfigured.
- Notifications: `createNotification(...)` in `c:\Qivo\apps\api\src\modules\notifications\notification.service.ts`.
- Web API client: `api.get/post/patch/delete` and `publicGet` from `c:\Qivo\apps\web\src\lib\api.ts`.

---

## Data model

### New enums and model (schema.prisma)

Add to `c:\Qivo\prisma\schema.prisma`:

```prisma
enum FormShareRole {
  RESPONDER
  EDITOR
  VIEWER
}

enum FormShareStatus {
  PENDING
  ACCEPTED
}

model FormShare {
  id          String          @id @default(cuid())
  formId      String
  email       String          // invited email, always stored lowercased
  userId      String?         // null until the invitee has/creates an account and is linked
  role        FormShareRole
  status      FormShareStatus  @default(PENDING)
  token       String          @unique // random; used in the signup/acceptance link
  invitedById String
  createdAt   DateTime        @default(now())
  acceptedAt  DateTime?

  form      Form  @relation(fields: [formId], references: [id], onDelete: Cascade)
  user      User? @relation("FormShareUser", fields: [userId], references: [id], onDelete: SetNull)
  invitedBy User  @relation("FormShareInviter", fields: [invitedById], references: [id])

  @@unique([formId, email])
  @@index([formId])
  @@index([userId])
}
```

> **Index note (resolves review finding #2):** `token String @unique` already creates a unique index (`FormShare_token_key`), which fully serves token lookup — a second non-unique `@@index([token])` would be a redundant duplicate index on the same column, so it is intentionally **omitted** from the model. There is exactly **one** compound unique, `@@unique([formId, email])` (Prisma accessor `formId_email`); there is **no** `@@unique([formId, token])`. Final index set: unique `token`, unique `(formId, email)`, non-unique `formId`, non-unique `userId`. The migration SQL below matches this exactly (no `FormShare_token_idx`).

**Relation back-references** must be added to the existing models (Prisma requires both sides):

- On `model Form`, add: `shares FormShare[]`
- On `model User`, add two named relations:
  - `formShares        FormShare[] @relation("FormShareUser")`
  - `formSharesInvited  FormShare[] @relation("FormShareInviter")`

Rationale for the choices:
- **Enum vs string** — use enums (`FormShareRole`, `FormShareStatus`). The codebase already models roles/statuses as Prisma enums (`WorkspaceRole`, `FormStatus`, `NotificationType`), enums give DB-level integrity and TS literal types for free, and the value set is small and fixed. (Decision 1.)
- **`token @unique`** — a random 32-byte hex token (generated with `randomBytes(32).toString("hex")`, matching `auth.service.ts`). Stored in plaintext because, unlike password-reset tokens, it is a capability to *join* a share whose acceptance additionally requires the logged-in user's email to equal the invited email; the token alone grants nothing. This mirrors how the invite link must be shareable by email.
- **`@@unique([formId, email])`** — one invite per (form, email); re-inviting upserts the existing row.
- **`onDelete: Cascade` on `formId`** — deleting a form removes its shares. `onDelete: SetNull` on `userId` so deleting a user doesn't destroy the invite history (keeps `email` + audit trail); such a row effectively reverts toward an unlinked invite and no longer grants that user access.
- **`invitedById`** has no `onDelete` override (defaults to `Restrict`), consistent with `Form.owner`'s relation which also has no cascade. Inviter accounts are not expected to be hard-deleted in this app.

### Migration (TWO separate folders — resolves review finding #1)

Follow the project convention: hand-authored timestamped folders under `c:\Qivo\prisma\migrations\` each containing a raw `migration.sql` (the most recent migration `20260925000000_add_google_id_and_respondent_email` was authored this way, not via an interactive `migrate dev`). Deployment runs `prisma migrate deploy` (`pnpm db:migrate`).

**Why two migrations, not one.** `prisma migrate deploy` wraps each `migration.sql` file in a **single transaction** for Postgres (it does *not* auto-commit statement-by-statement — the previous revision's claim to the contrary was wrong). `ALTER TYPE "NotificationType" ADD VALUE ...` on the pre-existing `NotificationType` enum has two Postgres constraints: on PG **< 12** it cannot run inside a transaction block at all, and on PG **≥ 12** the newly added value cannot be *used* later in the same transaction. The production Postgres major version on Railway is provisioned at deploy time and is not pinned in this repo, so we cannot assume ≥ 12. Therefore the `ADD VALUE` is isolated in its **own standalone migration folder containing only that one statement** — this is safe on every Postgres version and is exactly how Prisma itself emits enum-value additions. The two brand-new enums (`FormShareRole`, `FormShareStatus`) are created with `CREATE TYPE` and are unaffected by this hazard; they stay in the FormShare table migration.

Order the two folders so the enum value exists before anything could reference it (the FormShare table does not reference `NotificationType`, so strict ordering is not functionally required, but keeping the enum migration first is cleanest):

**Migration 1 — folder `c:\Qivo\prisma\migrations\20260926000000_add_form_shared_notification_type\`, file `migration.sql`:**

```sql
-- Standalone: adding a value to the existing NotificationType enum.
-- Must be its own migration so it is NOT wrapped in a transaction with
-- dependent DDL (Postgres forbids ALTER TYPE ... ADD VALUE inside a tx on
-- PG < 12, and forbids using the new value in the same tx on PG >= 12).
ALTER TYPE "NotificationType" ADD VALUE 'FORM_SHARED';
```

**Migration 2 — folder `c:\Qivo\prisma\migrations\20260926000100_add_form_share\`, file `migration.sql`:**

```sql
-- CreateEnum
CREATE TYPE "FormShareRole" AS ENUM ('RESPONDER', 'EDITOR', 'VIEWER');
CREATE TYPE "FormShareStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateTable
CREATE TABLE "FormShare" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "role" "FormShareRole" NOT NULL,
    "status" "FormShareStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    CONSTRAINT "FormShare_pkey" PRIMARY KEY ("id")
);

-- Indexes / constraints
-- (No FormShare_token_idx: the unique index below is the only token index.)
CREATE UNIQUE INDEX "FormShare_token_key" ON "FormShare"("token");
CREATE UNIQUE INDEX "FormShare_formId_email_key" ON "FormShare"("formId", "email");
CREATE INDEX "FormShare_formId_idx" ON "FormShare"("formId");
CREATE INDEX "FormShare_userId_idx" ON "FormShare"("userId");

-- Foreign keys
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormShare" ADD CONSTRAINT "FormShare_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Final index set on `FormShare`: `FormShare_token_key` (unique), `FormShare_formId_email_key` (unique), `FormShare_formId_idx`, `FormShare_userId_idx`. This matches the model block exactly (no `@@index([token])`, no `FormShare_token_idx`).

After editing the schema, run `pnpm db:generate` (`prisma generate`) so the client in `apps/api/src/generated/prisma` picks up `FormShare`, `FormShareRole`, `FormShareStatus`, the new `FORM_SHARED` notification value, and the new relation fields. Locally, `prisma migrate deploy` applies both SQL files in folder-name order; the generated client is committed/regenerated as the project already does.

---

## Effective access resolution

Access to a form for an authenticated user is:

```
workspace membership (existing)  OR  an ACCEPTED FormShare row for this form with a sufficient role
```

**Export-visibility note (resolves review finding #6):** in `form.service.ts` today, `getForm` and `updateForm` are **exported**, while `getEditableForm` and `getFormForResponseAccess` are **module-private** (`async function ...` with no `export`). The OR-fallback edits below are all *in-file* (they only add an OR branch inside each function body and import the access helpers). The implementer must **not** change any of these functions' export visibility while editing — no caller outside `form.service.ts` needs the private ones, and exporting them would be an unrelated API-surface change. No behavioral change beyond the added fallback.

Concretely, three new service helpers live in a new file `c:\Qivo\apps\api\src\modules\formShares\formShare.access.ts` so both the `forms` module and the `formShares`/`invites` module can import them without a circular dependency:

```ts
// Returns the highest effective capability a user has on a form via shares.
// null if no ACCEPTED share grants anything.
export async function getAcceptedShareRole(
  formId: string, userId: string,
): Promise<"EDITOR" | "VIEWER" | "RESPONDER" | null>

// True if an ACCEPTED EDITOR share exists for (formId, userId).
export async function hasEditorShare(formId: string, userId: string): Promise<boolean>

// True if an ACCEPTED EDITOR or VIEWER share exists for (formId, userId).
export async function hasResponseViewShare(formId: string, userId: string): Promise<boolean>
```

### Integration point for EDITOR per-form access (Decision 4)

`getEditableForm(formId, userId)` in `c:\Qivo\apps\api\src\modules\forms\form.service.ts` currently returns the form only if the user is a non-VIEWER workspace member, else throws `FORM_NOT_FOUND`. We **add a fallback** without touching the existing workspace query:

```ts
async function getEditableForm(formId: string, userId: string) {
  // 1) existing workspace path — UNCHANGED
  const form = await prisma.form.findFirst({ where: { id: formId, deletedAt: null,
    workspace: { members: { some: { userId, role: { not: "VIEWER" } } } } } });
  if (form) return form;

  // 2) NEW fallback: per-form EDITOR share
  if (await hasEditorShare(formId, userId)) {
    const shared = await prisma.form.findFirst({ where: { id: formId, deletedAt: null } });
    if (shared) return shared;
  }

  throw formNotFoundError("Form not found or not editable.");
}
```

Because the workspace query runs first and is unchanged, a VIEWER workspace member still cannot edit via the workspace path; only an explicit ACCEPTED EDITOR **share** adds edit capability, and only for that one form. This preserves existing workspace-role enforcement exactly. Every write path that already funnels through `getEditableForm` (create/update/delete question, sections, settings, reorder) inherits per-form edit access automatically.

`updateForm`, `deleteForm`, and `publishForm` do **not** use `getEditableForm` — they re-query with an inline membership check. For v1 we extend **`updateForm`** only (editing title/description is core "edit the form"). `deleteForm` and `publishForm` are deliberately left workspace-only (see Out of scope / rationale below): deleting or publishing a form is an ownership-level action, not something a per-form EDITOR collaborator should do. This is called out explicitly so it is a decision, not an oversight.

**`updateForm` has two distinct rejection points today (verified in `form.service.ts`), and the fallback must cover BOTH (resolves review finding #2):**

1. The initial `prisma.form.findFirst({ where: { ..., workspace: { members: { some: { userId } } } } })` matches **any** membership. For a user who is **not a workspace member at all** — the primary intended case for a per-form EDITOR share (an external HOD/principal) — this returns `null` and the function throws `FORM_NOT_FOUND` **before any role check**.
2. If a row is found but `membership.role === "VIEWER"`, it throws `FORBIDDEN`.

A naive "if the inline membership check fails, consult `hasEditorShare`" attached only to the VIEWER branch would leave the non-member editor-share grantee rejected at point (1) — the feature's core case silently broken. Therefore `updateForm` must be **restructured** so the `hasEditorShare` fallback runs whenever the workspace path does **not** yield an editable form — covering both "no membership row" and "VIEWER membership". Replace the body's access gate with a single non-VIEWER-member query plus the share fallback, collapsing the 404-vs-403 shape into one `FORM_NOT_FOUND` for the non-editable case:

```ts
export async function updateForm(
  formId: string,
  userId: string,
  input: { title?: string | undefined; description?: string | null | undefined },
) {
  // 1) workspace path: a NON-VIEWER member (role check folded into the query,
  //    unlike the old two-stage shape — a VIEWER no longer matches here).
  let form = await prisma.form.findFirst({
    where: { id: formId, deletedAt: null,
      workspace: { members: { some: { userId, role: { not: "VIEWER" } } } } },
  });

  // 2) NEW fallback: per-form EDITOR share. Runs for BOTH the non-member case
  //    AND the VIEWER-member case (both leave `form` null above).
  if (!form && (await hasEditorShare(formId, userId))) {
    form = await prisma.form.findFirst({ where: { id: formId, deletedAt: null } });
  }

  if (!form) throw formNotFoundError();

  return prisma.form.update({
    where: { id: formId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
    },
  });
}
```

This folds the old `membership.role === "VIEWER"` → `FORBIDDEN` check into the workspace query (`role: { not: "VIEWER" }`), so a VIEWER workspace member now falls through to the share fallback and, lacking an EDITOR share, gets `FORM_NOT_FOUND` instead of the previous `FORBIDDEN`. **Collapsing 403→404 here is acceptable and intentional** (it leaks less about form existence to a VIEWER and keeps the function single-shaped); an implementer who prefers to preserve the two-stage 404-vs-403 shape may do so **only if** the EDITOR-share fallback still covers the non-member path (point 1) — i.e. the fallback must not be gated behind "was a member row found". The workspace query still runs first and unchanged in intent (non-VIEWER member always wins), so no workspace-role enforcement is weakened; the share path only **adds** edit capability for one form.

`getForm(formId, userId)` (plain read of the form definition) is used by the editor UI to load a form. Extend it with an OR-fallback gated to **EDITOR/VIEWER shares only** via the existing `hasResponseViewShare(formId, userId)` helper (which already filters to ACCEPTED EDITOR-or-VIEWER). A RESPONDER-only share must **not** load the form document through this authenticated editor read path — `getAcceptedShareRole(...) !== null` would be true for RESPONDER and is therefore **not** used here; the condition is exactly `hasResponseViewShare(...)`. The existing workspace query runs first and unchanged; the fallback only runs when it returns nothing:

```ts
export async function getForm(formId: string, userId: string) {
  // 1) existing workspace path — UNCHANGED (any member may read the definition)
  const form = await prisma.form.findFirst({
    where: { id: formId, deletedAt: null,
      workspace: { members: { some: { userId } } } },
  });
  if (form) return form;

  // 2) NEW fallback: EDITOR/VIEWER share may load the form document. RESPONDER may NOT.
  if (await hasResponseViewShare(formId, userId)) {
    const shared = await prisma.form.findFirst({ where: { id: formId, deletedAt: null } });
    if (shared) return shared;
  }

  throw formNotFoundError();
}
```

(RESPONDER grants no editor-UI read; the form is public anyway, so a responder reaches it through the public `/f/<slug>` path, never through `getForm`. Keeping `getForm` strict to EDITOR/VIEWER means the authenticated editor/response surfaces never widen for RESPONDER.)

### Integration point for VIEWER response access

`getFormForResponseAccess(formId, userId)` currently requires a non-VIEWER workspace member and 403s a plain member. Add the OR-fallback: if the workspace query returns nothing, check `hasResponseViewShare(formId, userId)`; if true, load and return the form. This lets an ACCEPTED VIEWER (or EDITOR) share read responses for that one form. The 404-vs-403 disambiguation at the end stays, but is only reached when neither workspace membership nor a share grants access.

### RESPONDER

No backend permission change anywhere. A RESPONDER share only drives email delivery (below) and will populate a future "shared with me" list. It must never appear in any `hasEditorShare` / `hasResponseViewShare` / editable-or-viewable path.

---

## API module: `formShares`

New directory `c:\Qivo\apps\api\src\modules\formShares\` mirroring `members`:

- `formShare.schemas.ts`
- `formShare.service.ts`
- `formShare.access.ts` (the three helpers above)
- `formShare.routes.ts` (mounted at `/api/forms` — nested under a form id)
- `invite.routes.ts` (mounted at `/api/invites` — the public + accept surface)

### Schemas (`formShare.schemas.ts`)

```ts
import { z } from "zod";

export const createShareSchema = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(["RESPONDER", "EDITOR", "VIEWER"]),
});
```

No body schema needed for list/delete/accept (ids come from params; accept uses the authenticated user).

### Service (`formShare.service.ts`)

All functions take the acting user id and enforce that **only a form editor may manage shares**, via a local guard `requireFormEditor(formId, userId)` that calls the existing `getEditableForm` fallback logic (workspace non-VIEWER member OR ACCEPTED EDITOR share). To avoid a circular import (`forms` ↔ `formShares`), `requireFormEditor` is implemented in `formShare.service.ts` using `prisma` + `hasEditorShare` directly rather than importing from `form.service.ts`:

```ts
async function requireFormEditor(formId, userId) {
  const member = await prisma.form.findFirst({ where: { id: formId, deletedAt: null,
    workspace: { members: { some: { userId, role: { not: "VIEWER" } } } } }, select: { id: true } });
  if (member) return;
  if (await hasEditorShare(formId, userId)) return;
  throw forbiddenError("You do not have permission to manage sharing for this form.");
}
```

Functions:

**`listShares(formId, actorId)`**
- `await requireFormEditor(formId, actorId)`.
- Return `prisma.formShare.findMany({ where: { formId }, orderBy: { createdAt: "asc" }, include: { user: { select: { id, name, email, avatarUrl } } } })`.

**`createShare(formId, actorId, { email, role })`**
- `await requireFormEditor(formId, actorId)`.
- Normalize `email = email.trim().toLowerCase()`.
- Load the form (`id`, `title`, `slug`) and the actor name for the email/notification. If the form doesn't exist (or is soft-deleted) → `FORM_NOT_FOUND`.
- Look up `targetUser = prisma.user.findUnique({ where: { email } })`.

**Explicit read-then-write, not a Prisma `upsert` (resolves review finding #3).** A single `upsert` cannot express this feature's conflict rules: its `update` branch can only set literals, so it cannot "keep the existing token" and cannot branch on the row's current `status`. Implement it as a `findUnique` on the compound unique followed by a create-or-update. The compound-unique accessor generated by Prisma for `@@unique([formId, email])` is **`formId_email`** — use exactly that key:

```ts
const existing = await prisma.formShare.findUnique({
  where: { formId_email: { formId, email } },
});

let share;
if (!existing) {
  // First invite for this (form, email).
  share = await prisma.formShare.create({
    data: {
      formId,
      email,
      role,
      invitedById: actorId,
      token: randomBytes(32).toString("hex"), // matches auth.service.ts token style
      ...(targetUser
        ? { userId: targetUser.id, status: "ACCEPTED", acceptedAt: new Date() }
        : { status: "PENDING" }), // userId null, acceptedAt null by default
    },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
} else {
  // Re-invite of an existing (form, email) row.
  share = await prisma.formShare.update({
    where: { id: existing.id },
    data: {
      role, // ALWAYS update the role
      // Link + accept only when the row is still PENDING AND the user now has
      // an account. If already ACCEPTED, or still no account, leave status/
      // userId/acceptedAt as-is. `token` is OMITTED here so the original token
      // is preserved (a PENDING invite link already in someone's inbox keeps
      // working).
      ...(existing.status === "PENDING" && targetUser
        ? { userId: targetUser.id, status: "ACCEPTED", acceptedAt: new Date() }
        : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
  });
}
```

- **Side effects — every one is `void <promise>.catch(console.error)` (resolves review finding #4).** This is the correct rule stated on its own terms: a rejected notification or email promise must never crash the request or surface as an unhandled rejection. (Note: the members module is *not* a reliable precedent here — `inviteMember` has no new-user/PENDING path and never sends an invite email, and its `MEMBER_INVITED` `createNotification` call is `void` with **no** `.catch()`, which is the unhandled-rejection bug we are deliberately not copying. Any earlier prose justifying these side effects "by matching the members module" is withdrawn.) Fire the side effects based on the computed `share`/`targetUser`:
  - If `targetUser` exists (existing user — the share is now ACCEPTED/linked, including for RESPONDER): `void createNotification({ userId: targetUser.id, type: "FORM_SHARED", title, message, metadata: { formId, role, actorId } }).catch(console.error)` **and** `void sendFormShareExistingUserEmail(email, { inviterName, formTitle, role, slug, formId }).catch(console.error)`. **Pin the exact in-app copy `createShare` passes (resolves review finding #4):**
    ```ts
    const roleLabel = { EDITOR: "editor", VIEWER: "viewer", RESPONDER: "responder" }[role];
    const title = "Form shared with you";
    const message = `${inviterName} gave you ${roleLabel} access to "${formTitle}".`;
    ```
    These literals are local to `createShare` and are **independent** of the `notifyFormEvent` `messages`/`titles` maps — `createShare` calls `createNotification` directly and does **not** go through `notifyFormEvent`. (The maps still must gain a `FORM_SHARED` entry so the `Record<NotificationType, string>` typing stays exhaustive and compiles; see Notifications below.)
  - If no `targetUser` (new user — the share is PENDING): `void sendFormShareInviteEmail(email, { inviterName, formTitle, role, token: share.token }).catch(console.error)` with the signup+token link. No in-app notification (there is no account to notify yet).
- Return the `share` row (with the `user` include).

**`revokeShare(formId, shareId, actorId)`**
- `await requireFormEditor(formId, actorId)`.
- Verify the share belongs to the form: `prisma.formShare.findFirst({ where: { id: shareId, formId } })`; if missing → `SHARE_NOT_FOUND`.
- `prisma.formShare.delete({ where: { id: shareId } })`. Return `{ message: "Share revoked." }`.

**`getInviteByToken(token)`** (public)
- `prisma.formShare.findUnique({ where: { token }, include: { form: { select: { id, title, slug } }, invitedBy: { select: { name } } } })`.
- If missing → `INVALID_TOKEN`.
- Return a **minimal** public projection: `{ formTitle, role, inviterName, status }`. Do **not** leak email, userId, form schema, or workspace internals.

**`acceptInvite(token, user)`** (authenticated; `user = req.user`)
- Load share by token (include form slug/title). If missing → `INVALID_TOKEN`.
- If `status === "ACCEPTED"` and `userId === user.id` → idempotent success (return the share + redirect target). If `ACCEPTED` and linked to a *different* user → `INVALID_TOKEN` ("This invite has already been used.").
- **Email-match security check (Decision 2):** require `user.email.toLowerCase() === share.email`. On mismatch → throw `FORBIDDEN` ("This invite was sent to a different email address."). Rationale below.
- Update: `{ userId: user.id, status: "ACCEPTED", acceptedAt: new Date() }`.
- Fire a `createNotification` to the inviter is optional; v1 skips it (keeps noise down).
- Return `{ formId, slug, role }` so the route can tell the client where to redirect.

**`listSharedWithMe(userId)`** (Decision 3 — included, minimal)
- `prisma.formShare.findMany({ where: { userId, status: "ACCEPTED" }, include: { form: { select: { id, title, slug, status } } }, orderBy: { acceptedAt: "desc" } })`.
- Map to `{ shareId, role, form: { id, title, slug, status } }`. This is a read-only, cheap query; a full dashboard section is deferred, but the endpoint ships so the acceptance flow has somewhere to point and the frontend can list "forms shared with me".
- **Intended behavior for RESPONDER (resolves review finding #7):** an existing-user RESPONDER share is auto-ACCEPTED and linked by `createShare`, so it **does** appear here immediately — this is intentional and correct. RESPONDER grants no *backend permission* (the form is public either way), but "shared with me" is precisely the place a responder finds the form link that was emailed to them. A PENDING new-user RESPONDER invite is excluded (it has no `userId` and `status` is PENDING) until that person signs up and accepts, at which point it appears too. So the rule is consistent: `shared-with-me` lists every ACCEPTED+linked share for the user regardless of role, and the only role-specific behavior lives in the access helpers (which exclude RESPONDER), never here.

Error helpers (`forbiddenError`, `notFoundError`) copied from the members module pattern. New error `.name`s introduced: **`SHARE_NOT_FOUND`**. `INVALID_TOKEN`, `FORBIDDEN`, `FORM_NOT_FOUND`, `USER_NOT_FOUND` already exist in `app.ts`'s switch; **add `SHARE_NOT_FOUND` → 404** to that switch.

### Routes

**`formShare.routes.ts`** — exported as `formShareRouter`, all `requireAuth`:

| Method | Path | Handler | Auth | Notes |
|---|---|---|---|---|
| POST | `/api/forms/:formId/shares` | `createShare` | Bearer, editors only | `createShareSchema.parse(req.body)`; `201` with `{ share }` |
| GET | `/api/forms/:formId/shares` | `listShares` | Bearer, editors only | `{ shares }` |
| DELETE | `/api/forms/:formId/shares/:shareId` | `revokeShare` | Bearer, editors only | `{ message }` |
| GET | `/api/forms/shared-with-me` | `listSharedWithMe` | Bearer | `{ shares }` |

Each handler follows the exact shape used across `member.routes.ts` / `form.routes.ts`: guard `if (!req.user) return 401`, validate params are strings, `parse` body, call the service, wrap result in `{ success: true, data: {...} }`, `catch (error) { next(error); }`.

**Mounting / route-ordering caveat (critical):** `formRouter` is mounted at `/api/forms` and defines a parameterized `GET /:formId`. A sibling literal route `GET /api/forms/shared-with-me` must be registered **before** the `:formId` catch-all or it will be swallowed. Two options; we choose option A:

- **Option A (chosen):** Register `formShareRouter` on the **same** `/api/forms` mount **before** `formRouter` in `app.ts`, and inside `formShareRouter` declare `GET /shared-with-me` first, then the `/:formId/shares` routes. Because Express matches in registration order across routers on the same base path, putting `formShareRouter` first guarantees `shared-with-me` resolves before `formRouter`'s `/:formId`.
- Option B (rejected): put `shared-with-me` under a different base like `/api/form-shares/me`. Rejected only to keep the spec's `/api/forms/shared-with-me` path; Option A satisfies it cleanly.

So in `c:\Qivo\apps\api\src\app.ts`, change:

```ts
import formShareRouter from "./modules/formShares/formShare.routes.js";
import inviteRouter from "./modules/formShares/invite.routes.js";
// ...
app.use("/api/forms", formShareRouter); // BEFORE formRouter so /shared-with-me wins
app.use("/api/forms", formRouter);
app.use("/api/invites", inviteRouter);
```

**`invite.routes.ts`** — exported as `inviteRouter`:

| Method | Path | Handler | Auth | CSRF |
|---|---|---|---|---|
| GET | `/api/invites/:token` | `getInviteByToken` | **public (no `requireAuth`)** | GET is a safe method → always passes `csrfProtection` |
| POST | `/api/invites/:token/accept` | `acceptInvite` | `requireAuth` (Bearer) | Bearer requests are exempt from `csrfProtection` |

CSRF verification against `csrf.ts`: `GET /api/invites/:token` is a `GET`, which `csrfProtection` lets through unconditionally (safe method) — no change to `csrf.ts` needed and it does not need to be in a "public" allowlist. `POST /api/invites/:token/accept` is Bearer-authenticated (the web app always sends `Authorization: Bearer`), and `csrfProtection` explicitly skips Bearer requests. **No edits to `csrf.ts` are required.** (The global `apiLimiter` of 100/15min applies to `/api/invites/*`, which is fine for human-paced invite acceptance.)

---

## Email (`c:\Qivo\apps\api\src\services\email.ts`)

Add two exported functions matching the existing `sendTeamInviteEmail` style (plain params, `layout(...)` + `button(...)`, `await sendEmail(...)` which already no-ops silently when `RESEND_API_KEY` is unset — verified in `sendEmail`'s `getResendKey()` branch).

Signatures:

```ts
export async function sendFormShareInviteEmail(
  to: string,
  opts: { inviterName: string; formTitle: string; role: "RESPONDER" | "EDITOR" | "VIEWER"; token: string },
): Promise<void>

export async function sendFormShareExistingUserEmail(
  to: string,
  opts: { inviterName: string; formTitle: string; role: "RESPONDER" | "EDITOR" | "VIEWER"; slug: string; formId: string },
): Promise<void>
```

Link construction (reuse the module's `getWebUrl()`):

- **New user (PENDING)** → `sendFormShareInviteEmail`: link to `${WEB_URL}/signup?invite=<token>`. Subject: `"${inviterName} invited you to ${roleVerb} the form "${formTitle}" on Qivo"`. Body: `"${inviterName} invited you to ${roleLabel} the form <strong>${formTitle}</strong> on Qivo Forms. Create your account to accept:"` + `button(signupUrl, "Accept invite")`.
- **Existing user** → `sendFormShareExistingUserEmail`: link depends on role:
  - `EDITOR` → `${WEB_URL}/forms/<formId>/edit`
  - `VIEWER` → `${WEB_URL}/forms/<formId>/responses`
  - `RESPONDER` → `${WEB_URL}/f/<slug>` (the public form)
  - Subject: `"You've been given ${roleLabel} access to "${formTitle}" on Qivo"`. Body uses the role-appropriate `button(link, label)`.

A small local `roleLabel`/`roleVerb` map keeps copy consistent (`EDITOR → "edit"`, `VIEWER → "view responses for"`, `RESPONDER → "respond to"`). No env changes beyond the already-documented `RESEND_API_KEY` / `EMAIL_FROM` / `WEB_URL`; note in `.env.example` that these are reused (the spec flags the example as stale — add `# RESEND_API_KEY / EMAIL_FROM used for password reset AND form-share invites` but behavior is identical to forgot-password).

---

## Notifications

Add a new `NotificationType` value **`FORM_SHARED`** so existing-user shares produce an in-app notification.

- schema.prisma: add `FORM_SHARED` to `enum NotificationType`.
- The `ALTER TYPE "NotificationType" ADD VALUE 'FORM_SHARED';` ships in its **own standalone migration** `20260926000000_add_form_shared_notification_type` (see the "Migration" section above). It is deliberately **not** bundled with the FormShare table DDL: `prisma migrate deploy` wraps each `migration.sql` in a single transaction, and `ALTER TYPE ... ADD VALUE` is illegal inside a transaction on PG < 12 and cannot be used in the same transaction on PG ≥ 12. Isolating it is safe on all Postgres versions. (This corrects the previous revision's incorrect "runs statement-by-statement" claim — resolves review finding #1.)
- `notification.service.ts`: extend the local `NotificationType` union and add a `FORM_SHARED` entry to **both** the `messages` and `titles` maps in `notifyFormEvent` so the `Record<NotificationType, string>` typing stays exhaustive and the file compiles. These map entries are a static fallback only — `createShare` never calls `notifyFormEvent`; it calls `createNotification` directly with the pinned `title`/`message` literals above. Use `titles.FORM_SHARED = "Form shared with you"` and a generic `messages.FORM_SHARED = "A form was shared with you."` (the per-share, inviter-personalized copy comes from `createShare`'s literals, not from this map).

---

## Signup → acceptance flow (web)

### `SignupPage.tsx` (`c:\Qivo\apps\web\src\pages\SignupPage.tsx`)

- Read the invite token from the query string: `const inviteToken = new URLSearchParams(useLocation().search).get("invite")`.
- On successful signup (`setToken(data.token)`), **if `inviteToken` is present**, `navigate(\`/accept-invite?token=${encodeURIComponent(inviteToken)}\`)`; otherwise keep `navigate("/dashboard")`.
- Keep the token in the "Already have an account? Log in" link so an existing user who followed a new-user link still carries it: `to={inviteToken ? \`/login?invite=${inviteToken}\` : "/login"}`.

### `LoginPage.tsx` (`c:\Qivo\apps\web\src\pages\LoginPage.tsx`)

- Same pattern: read `invite` from the query string; after `setToken` (both password and Google callbacks) redirect to `/accept-invite?token=...` when present, else `/dashboard`.
- Carry the token onto the "Don't have an account? Sign up" link so a brand-new invitee who was bounced to `/login?invite=T` can switch to signup without losing the token: `to={inviteToken ? \`/signup?invite=${inviteToken}\` : "/signup"}`. (Symmetric to the `SignupPage` → login link above; together they guarantee the token survives a user toggling between the two auth pages.)

### `GuestOnly` wrapper (`App.tsx`)

- `GuestOnly` currently force-redirects logged-in users from `/login` and `/signup` to `/dashboard`, which would strip an `invite` token for an already-logged-in user who clicked a new-user invite link (`/signup?invite=T`) or was bounced to `/login?invite=T`. **The current `GuestOnly` (verified in `App.tsx`) imports no router location hook — it only calls `getToken()`.** So the implementer must first add `import { useLocation } from "react-router-dom"` (the module already imports `Navigate` from it) and add `const location = useLocation();` inside `GuestOnly` before reading the query string. `GuestOnly` renders inside `<BrowserRouter>`, so `useLocation()` is valid in scope. Then: read `invite` via `new URLSearchParams(location.search).get("invite")`; if a token is present, redirect the logged-in user to `/accept-invite?token=<invite>` instead of `/dashboard`. Concretely:

```tsx
import { Navigate, useLocation } from "react-router-dom";
// ...
function GuestOnly({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  if (getToken()) {
    const invite = new URLSearchParams(location.search).get("invite");
    return <Navigate to={invite ? `/accept-invite?token=${encodeURIComponent(invite)}` : "/dashboard"} replace />;
  }
  return <>{children}</>;
}
```

This covers Decision 5's "already logged in" case — an existing, already-authenticated user who opens an invite link lands straight on the acceptance page.

### `AuthGuard.tsx` special-case (`c:\Qivo\apps\web\src\components\AuthGuard.tsx`) — resolves review finding #5

**Current behavior (verified):** when the auth check finds no user, `AuthGuard` returns `<Navigate to="/login" state={{ from: location.pathname }} replace />`. Two facts make the previous revision's plan dead code: (a) the redirect target is **hard-coded `/login`** with **no query string**, so an unauthenticated hit on `/accept-invite?token=T` lands on `/login` with the token dropped; and (b) **nothing in the app ever reads `state.from`** — `LoginPage`/`SignupPage` unconditionally navigate to `/dashboard`. So merely changing `state.from` to include `location.search` accomplishes nothing, and because `AcceptInvitePage` is behind `AuthGuard`, the unauthenticated user never renders the page and never sees any `?invite=` CTA the page might draw.

**Chosen fix — special-case the invite path inside `AuthGuard` (option (a) from the review).** Keep `AcceptInvitePage` behind `AuthGuard`, and make the no-user redirect carry the token:

```tsx
if (!user) {
  const params = new URLSearchParams(location.search);
  const inviteToken = location.pathname === "/accept-invite" ? params.get("token") : null;
  const to = inviteToken ? `/login?invite=${encodeURIComponent(inviteToken)}` : "/login";
  return <Navigate to={to} replace />;
}
```

This is the only change to `AuthGuard`. The `state.from` search-preservation idea from the previous revision is **dropped entirely** — it was dead code (no consumer reads `state.from`), and the `?invite=` query mechanism is what actually carries the token round-trip. Everything else in `AuthGuard` (the `checkAuth` effect, the `checking` skeleton, token clearing on 401) is untouched. With this change the full flow is: unauthenticated `/accept-invite?token=T` → `/login?invite=T` → user logs in or clicks "sign up" (which must carry `?invite=T`, see `LoginPage` below) → `LoginPage`/`SignupPage` read `?invite=` → `/accept-invite?token=T` → now authenticated, `AcceptInvitePage` renders → Accept.

### New page `AcceptInvitePage.tsx` (`c:\Qivo\apps\web\src\pages\AcceptInvitePage.tsx`)

Rendered behind `AuthGuard` (must be logged in to accept; the `AuthGuard` special-case above routes unauthenticated users to `/login?invite=<token>` first). Behavior:

1. Read `token` from the query string. If absent → show an error state.
2. On mount, `publicGet<{ invite: { formTitle; role; inviterName; status } }>(\`/api/invites/${token}\`)` to display title/role/inviter. (Uses `publicGet` since the GET endpoint is public; works whether or not auth is attached.) Handle `INVALID_TOKEN` → "This invite link is invalid or has expired."
3. If `invite.status === "ACCEPTED"`, show "Already accepted" with a button to open the form.
4. **Accept** button → `api.post<{ formId; slug; role }>(\`/api/invites/${token}/accept\`)`. On success, redirect by role:
   - `EDITOR` → `/forms/${formId}/edit`
   - `VIEWER` → `/forms/${formId}/responses`
   - `RESPONDER` → `/f/${slug}`
   with a success flash (query param or local state).
5. Error handling via `ApiRequestError.code`:
   - `FORBIDDEN` (email mismatch) → "This invite was sent to a different email address. Log in with that address to accept."
   - `INVALID_TOKEN` → invalid/expired/already-used message.
6. **Not-logged-in routing (Decision 5) — see the AuthGuard special-case below.** An unauthenticated user who lands on `/accept-invite?token=T` is bounced by `AuthGuard` *before* `AcceptInvitePage` renders, so the page cannot show its own CTA to that user. The token is preserved by special-casing `AuthGuard` to redirect to `/login?invite=T` (detailed next). Once the user logs in or signs up, `LoginPage`/`SignupPage` read `?invite=` and send them to `/accept-invite?token=T`, where `AcceptInvitePage` now renders (they are authenticated) and the Accept button works.

### Route registration (`App.tsx`)

Add inside `<Routes>`, in the protected group:

```tsx
import AcceptInvitePage from "./pages/AcceptInvitePage";
// ...
<Route path="/accept-invite" element={<Protected>{() => <AcceptInvitePage />}</Protected>} />
```

`Protected` wraps with `AuthGuard` + `AppLayout`, consistent with every other logged-in page.

---

## Frontend share UI (`FormSharePage.tsx`)

Extend `c:\Qivo\apps\web\src\pages\FormSharePage.tsx` with a new card below the existing QR/link card, mirroring `TeamPage.tsx`'s invite UX (`handleInvite` + `message`/`error` state + members-style list).

New state:
```ts
const [shares, setShares] = useState<FormShare[]>([]);
const [inviteEmail, setInviteEmail] = useState("");
const [inviteRole, setInviteRole] = useState<FormShareRole>("RESPONDER");
const [inviting, setInviting] = useState(false);
const [shareMessage, setShareMessage] = useState("");
const [shareError, setShareError] = useState("");
```

On load (extend the existing `loadForm` effect), after fetching the form also fetch shares:
```ts
const data = await api.get<{ shares: FormShare[] }>(`/api/forms/${formId}/shares`);
setShares(data.shares);
```
(Only editors can list; since this page is already behind `AuthGuard` and the user reached the form's share page, a `FORBIDDEN`/`403` is surfaced as a benign "You don't have permission to manage sharing" note rather than breaking the page.)

Handlers:
- `handleSendInvite(e)` → `e.preventDefault()`, `api.post(\`/api/forms/${formId}/shares\`, { email: inviteEmail.trim().toLowerCase(), role: inviteRole })`; on success set a message ("Invited {email} as {role}." — if the response share is `PENDING`, "We emailed them a sign-up link."), clear the input, reload shares. Catch → `shareError`.
- `handleRevoke(shareId)` → confirm, `api.delete(\`/api/forms/${formId}/shares/${shareId}\`)`, reload shares.

UI:
- Role `<select>` with `RESPONDER` / `EDITOR` / `VIEWER` and a short description line (reuse the `ROLE_DESCRIPTIONS` idea from `TeamPage`): Responder = "Gets the public form link by email.", Editor = "Can edit this form.", Viewer = "Can view this form's responses.".
- Shares list rows showing email (or linked user name/email when `share.user` present), a role pill, a status pill (`Pending` amber / `Accepted` green), and a `×` revoke button. Styling reuses existing classes (`status-pill`, `secondary-button`, `danger-button`, `submit-error`, `editor-message`).

### API client (`c:\Qivo\apps\web\src\lib\api.ts`)

No new functions needed — the generic `api.get/post/delete` and `publicGet` cover every call. (Consistent with how `TeamPage`/`FormSharePage` call `api.*` directly with inline paths.)

### Types (`c:\Qivo\apps\web\src\types\index.ts`)

Add, in parity with the Prisma enums/model:

```ts
export type FormShareRole = "RESPONDER" | "EDITOR" | "VIEWER";
export type FormShareStatus = "PENDING" | "ACCEPTED";

export type FormShare = {
  id: string;
  formId: string;
  email: string;
  role: FormShareRole;
  status: FormShareStatus;
  createdAt: string;
  acceptedAt?: string | null;
  user?: { id: string; name: string; email: string; avatarUrl?: string | null } | null;
};

export type SharedWithMeItem = {
  shareId: string;
  role: FormShareRole;
  form: { id: string; title: string; slug: string; status: string };
};

export type InvitePreview = {
  formTitle: string;
  role: FormShareRole;
  inviterName: string;
  status: FormShareStatus;
};
```

---

## Validation rules (external inputs)

| Input | Where | Rule | On failure |
|---|---|---|---|
| `email` (create share) | `createShareSchema` | required, trimmed, valid email, ≤200 chars; service lowercases | Zod → `VALIDATION_ERROR` 400 |
| `role` (create share) | `createShareSchema` | required, one of `RESPONDER/EDITOR/VIEWER` | Zod → 400 |
| `formId`, `shareId` | route params | required strings | handler guards → 400 `INVALID_*` |
| `token` (GET invite) | route param | required string; looked up | not found → `INVALID_TOKEN` 400 |
| `token` (accept) | route param | required string; looked up; not already used by another user | missing/used → `INVALID_TOKEN` 400 |
| accept email match | service | `req.user.email.toLowerCase() === share.email` | mismatch → `FORBIDDEN` 403 |
| manage-shares authorization | service | workspace non-VIEWER member OR ACCEPTED EDITOR share | neither → `FORBIDDEN` 403 |

---

## Error handling (per operation)

| Operation | Failure condition | Recoverable? | Caller receives | Logged? |
|---|---|---|---|---|
| `createShare` | not a form editor | yes (caller lacks rights) | 403 `FORBIDDEN` | no (expected) |
| `createShare` | form missing/deleted | no | 404 `FORM_NOT_FOUND` | no |
| `createShare` | invalid body | yes | 400 `VALIDATION_ERROR` | no |
| `createShare` | email send fails | yes (non-fatal) | 201 success anyway | yes, `console.error` inside `sendEmail` (never throws) |
| `createShare` | notification fails | yes (non-fatal) | 201 success anyway | yes, via `void ....catch(console.error)` |
| `listShares` | not a form editor | yes | 403 `FORBIDDEN` | no |
| `revokeShare` | share not on this form | no | 404 `SHARE_NOT_FOUND` | no |
| `getInviteByToken` | token unknown | no | 400 `INVALID_TOKEN` | no |
| `acceptInvite` | token unknown | no | 400 `INVALID_TOKEN` | no |
| `acceptInvite` | already used by another user | no | 400 `INVALID_TOKEN` | no |
| `acceptInvite` | email mismatch | yes (log in as invited email) | 403 `FORBIDDEN` | no |
| `acceptInvite` | already accepted by same user | n/a | 200 idempotent success | no |
| any | unexpected throw | no | 500 `INTERNAL_SERVER_ERROR` | yes (central `errorHandler` logs) |

Email and notification side effects are strictly fire-and-forget and must never fail the request, matching the members module. `sendEmail` already swallows and logs its own errors.

---

## Invariants and ownership

- **"Submission is always public"** — owned by `getPublicForm`/submission path, which this feature does not touch. No share role changes submission.
- **"Workspace role enforcement is never weakened"** — owned by `getEditableForm`/`getFormForResponseAccess`/`updateForm`: the existing workspace query runs **first and unchanged**; shares only add an OR-fallback. A VIEWER workspace member cannot gain edit via workspace path; only an explicit EDITOR share adds it, scoped to one form.
- **"One invite per (form, email)"** — owned by the DB `@@unique([formId, email])` + the upsert in `createShare`.
- **"A share grants access only after ACCEPTED"** — owned by the access helpers, which all filter `status: "ACCEPTED"`. A PENDING row grants nothing.
- **"Invite acceptance requires matching email"** — owned by `acceptInvite` (application layer), because the identity-to-email binding lives in the `User`/session, not enforceable by the DB.

---

## Decisions

1. **FormShare schema + enum vs string — ENUM.** Use `FormShareRole` and `FormShareStatus` Prisma enums (full model given above). Matches existing `WorkspaceRole`/`FormStatus`/`NotificationType`, gives DB integrity and TS literal types, small fixed value set. String columns would lose both and invite typo bugs.

2. **Email-match requirement on accept — REQUIRE match.** `acceptInvite` requires the logged-in user's email to equal the invited email (both lowercased). Rationale: the token is emailed and could be forwarded; without the match, anyone who obtains the link could bind a form (including EDITOR access) to their own account. Requiring the match ties the capability to the intended recipient's verified account. The tradeoff — a user who signed up with a different email than the invite can't accept — is surfaced with a clear 403 message telling them which address to use. This is consistent with the intent of "invite this specific person."

3. **`GET /api/forms/shared-with-me` + "Shared with me" — IN SCOPE (minimal).** The endpoint ships (it's a single cheap indexed query on `userId + status`) and the frontend types are added, because the acceptance flow and RESPONDER role only make sense if the invitee can later find the form. A dedicated dashboard **section/page** with its own navigation is **deferred**; v1 exposes the endpoint and the `SharedWithMeItem` type so a later UI iteration is a pure frontend add. The `AcceptInvitePage` redirect already lands users on the right page, so no "shared with me" list is required for the core flow to work end-to-end.

4. **EDITOR per-form access integration — OR-fallback inside `getEditableForm` (and `updateForm`, `getForm`, `getFormForResponseAccess`).** The existing workspace query runs first and unchanged; a `hasEditorShare`/`hasResponseViewShare` check is appended only when the workspace path returns nothing. `deleteForm` and `publishForm` stay workspace-only by deliberate choice (ownership-level actions, not collaborator actions). This adds access to exactly one form and cannot weaken workspace enforcement. Access helpers live in `formShare.access.ts` to avoid a `forms` ↔ `formShares` circular import.

5. **Acceptance-page routing when not logged in — carry the token through the `?invite=` query, with an `AuthGuard` special-case.** `/accept-invite` sits behind `AuthGuard`. Because `AuthGuard` redirects to a hard-coded `/login` and nothing reads `state.from`, the token is carried purely by the `?invite=` query mechanism. The single `AuthGuard` change special-cases the invite path: an unauthenticated hit on `/accept-invite?token=T` redirects to `/login?invite=T` (not bare `/login`). `SignupPage` and `LoginPage` read `?invite=` and, after auth, redirect to `/accept-invite?token=T`; they also carry the token across each other's cross-links (login ↔ signup). `GuestOnly` sends an already-logged-in user with `?invite=` straight to `/accept-invite`. The previous revision's `state.from` search-preservation idea is **dropped** as dead code. The round-trip is: email link → `/signup?invite=T` (new) or `/login?invite=T` (bounce/existing) → auth success → `/accept-invite?token=T` → Accept → role-based redirect.

---

## Testability

- **Unit-testable (pure/service logic):** `getAcceptedShareRole`/`hasEditorShare`/`hasResponseViewShare` against a seeded DB (or mocked `prisma`); `acceptInvite` branches (unknown token, email mismatch, already-used, idempotent re-accept); `createShare` existing-vs-new-user branching and upsert-on-reinvite; email link construction per role (`sendFormShareInviteEmail`/`...ExistingUserEmail` building correct URLs — assert via the dev-console path / by injecting a spy, since `sendEmail` no-ops without a key).
- **Integration-testable (HTTP):** full invite → signup → accept → access flow against a test DB; authorization (non-editor gets 403 on create/list/revoke; VIEWER share can read responses but not edit; EDITOR share can edit but not delete/publish); route ordering (`GET /api/forms/shared-with-me` resolves before `/:formId`); CSRF/public behavior of `GET /api/invites/:token` and Bearer-only accept.
- **Frontend:** `AcceptInvitePage` states (loading, invalid token, already accepted, email-mismatch error, success redirect); `FormSharePage` invite card (send, list, revoke, pending vs accepted rendering).

The design is structured so that the backend access rule (`workspace OR accepted-share`) is isolated in three small helper functions — this keeps the most security-sensitive logic independently unit-testable rather than entangled in each route.

---

## File change summary (absolute paths)

New:
- `c:\Qivo\prisma\migrations\20260926000000_add_form_shared_notification_type\migration.sql` (standalone `ALTER TYPE ... ADD VALUE 'FORM_SHARED'`)
- `c:\Qivo\prisma\migrations\20260926000100_add_form_share\migration.sql` (FormShare enums + table + indexes + FKs)
- `c:\Qivo\apps\api\src\modules\formShares\formShare.schemas.ts`
- `c:\Qivo\apps\api\src\modules\formShares\formShare.access.ts`
- `c:\Qivo\apps\api\src\modules\formShares\formShare.service.ts`
- `c:\Qivo\apps\api\src\modules\formShares\formShare.routes.ts`
- `c:\Qivo\apps\api\src\modules\formShares\invite.routes.ts`
- `c:\Qivo\apps\web\src\pages\AcceptInvitePage.tsx`

Modified:
- `c:\Qivo\prisma\schema.prisma` — add `FormShareRole`, `FormShareStatus`, `FormShare`; add relation fields on `Form` and `User`; add `FORM_SHARED` to `NotificationType`.
- `c:\Qivo\apps\api\src\app.ts` — import + mount `formShareRouter` (before `formRouter`) and `inviteRouter`; add `SHARE_NOT_FOUND` → 404 to `errorHandler`.
- `c:\Qivo\apps\api\src\modules\forms\form.service.ts` — OR-fallback in `getEditableForm`, `getForm`, `getFormForResponseAccess`, `updateForm` using the access helpers.
- `c:\Qivo\apps\api\src\services\email.ts` — add `sendFormShareInviteEmail`, `sendFormShareExistingUserEmail`.
- `c:\Qivo\apps\api\src\modules\notifications\notification.service.ts` — add `FORM_SHARED` to union + `messages`/`titles` maps.
- `c:\Qivo\apps\web\src\App.tsx` — add `/accept-invite` route; update `GuestOnly` to preserve `?invite=`.
- `c:\Qivo\apps\web\src\components\AuthGuard.tsx` — special-case the no-user redirect so `/accept-invite?token=T` goes to `/login?invite=T` (drop the dead `state.from` idea).
- `c:\Qivo\apps\web\src\pages\SignupPage.tsx` — read `?invite=`, redirect to `/accept-invite` post-signup, carry token on the login link.
- `c:\Qivo\apps\web\src\pages\LoginPage.tsx` — read `?invite=`, redirect to `/accept-invite` post-login (password + Google), carry token on the signup link.
- `c:\Qivo\apps\web\src\pages\FormSharePage.tsx` — add invite card + shares list + revoke.
- `c:\Qivo\apps\web\src\types\index.ts` — add `FormShareRole`, `FormShareStatus`, `FormShare`, `SharedWithMeItem`, `InvitePreview`.
- `c:\Qivo\.env.example` — clarify `RESEND_API_KEY`/`EMAIL_FROM`/`WEB_URL` are reused for form-share invites.

## Out of scope

- Gating form submission (forms remain public).
- A dedicated "Shared with me" dashboard page/nav (endpoint + types ship; UI section deferred).
- Per-form EDITOR being able to delete or publish a form (ownership/workspace-only by decision).
- Resending/expiring invites, invite reminder emails, bulk invites.
- Webhooks/integrations (explicitly on hold per the user).

---

## Responses to design review findings

Two review passes have run against this design. All findings from both are addressed; none are backlogged or overridden. Every change stays consistent with the original confirmed feature spec (forms always public; purely-additive per-form access; three roles; email delivery).

### Latest review pass (`design-verdict.json` — verdict CHANGES_REQUESTED)

This pass found no factual mis-reading of the codebase; the two MEDIUM findings were internal inconsistencies / under-specifications in the design itself, plus two NITs. Each was verified against the real `form.service.ts` / `App.tsx` source before fixing.

**#1 [MEDIUM] — `getForm` share-fallback condition contradicted its own intent. ADDRESSED.** The `getForm` paragraph in "Integration point for EDITOR per-form access" previously said to extend with an OR-fallback "against `getAcceptedShareRole(...) !== null`" and then "gate it to EDITOR/VIEWER only" — contradictory, because `getAcceptedShareRole` also returns `RESPONDER`, so `!== null` would admit a RESPONDER-only share into the authenticated editor read path. The paragraph is rewritten to use **exactly `hasResponseViewShare(formId, userId)`** (ACCEPTED EDITOR or VIEWER only); the `getAcceptedShareRole(...) !== null` wording is deleted. A concrete `getForm` code block now shows the single strict condition, with the existing any-member workspace query unchanged and running first. Verified against the real `getForm` (any-membership `findFirst`, else `formNotFoundError()`).

**#2 [MEDIUM] — `updateForm` OR-fallback under-specified for the non-member editor-share case. ADDRESSED.** Verified in source that `updateForm` has two rejection points: an initial `findFirst` matching **any** membership (so a non-member hits `null` → `FORM_NOT_FOUND` before any role check) and a later `VIEWER` → `FORBIDDEN`. The core external-authority use case (EDITOR share, not a workspace member) is rejected at point 1. The design now **restructures** `updateForm` with a full code block: a single non-VIEWER-member query (`role: { not: "VIEWER" }`), then the `hasEditorShare` fallback that runs whenever that query yields no form — covering **both** the non-member and VIEWER-member cases — then load-by-id and update. It states that collapsing 403→404 for the non-editable case is acceptable and intentional, and that preserving the two-stage shape is allowed only if the fallback still covers the non-member path (not gated behind "member row found"). Workspace enforcement is unchanged (non-VIEWER member always wins first).

**#3 [NIT] — `GuestOnly` referenced `location.search` without a router hook. ADDRESSED.** Verified the current `GuestOnly` imports no location hook. The `App.tsx` `GuestOnly` subsection now instructs the implementer to add `import { useLocation } from "react-router-dom"` and `const location = useLocation();` inside `GuestOnly` (valid because it renders inside `<BrowserRouter>`) before reading `new URLSearchParams(location.search).get("invite")`, with a full code block.

**#4 [NIT] — `createShare` notification `title`/`message` copy not pinned. ADDRESSED.** The `createShare` side-effects bullet now pins exact literals: `title = "Form shared with you"` and `` message = `${inviterName} gave you ${roleLabel} access to "${formTitle}".` `` with a `roleLabel` map, and states they are **independent** of the `notifyFormEvent` maps (which `createShare` does not use). The Notifications section is updated to note its `messages`/`titles` `FORM_SHARED` entries are a static fallback that exists only to keep the `Record<NotificationType, string>` typing exhaustive, not the per-share copy.

### Prior review pass (earlier `design-review.md` revision — all resolved and retained)

**P1 [HIGH] — `ALTER TYPE ... ADD VALUE` transaction hazard. ADDRESSED.** Enum-value addition split into its own standalone migration folder `20260926000000_add_form_shared_notification_type`; FormShare enums + table in `20260926000100_add_form_share`. Correct per-file-transaction rationale given; safe on all Postgres versions.

**P2 [MEDIUM] — contradictory token index / stray compound unique. ADDRESSED.** Only `token String @unique` (no `@@index([token])`); migration SQL creates no `FormShare_token_idx`; single compound unique `formId_email`. Model, prose, and SQL agree.

**P3 [MEDIUM] — upsert conflict logic not expressible. ADDRESSED.** `createShare` uses explicit `findUnique({ where: { formId_email: { formId, email } } })` then create-or-update, always setting `role`, conditionally linking only when `existing.status === "PENDING" && targetUser`, omitting `token` to preserve it.

**P4 [MEDIUM] — false "matches the members module" justifications. ADDRESSED.** Every side effect is `void <promise>.catch(console.error)` on its own terms; the members-module precedent is withdrawn with a note on its missing `.catch()`.

**P5 [MEDIUM] — not-logged-in acceptance routing / dead `state.from`. ADDRESSED.** `AuthGuard` special-cases `/accept-invite?token=T` → `/login?invite=T`; `state.from` idea dropped as dead code; token carried via `?invite=` across login↔signup cross-links and `GuestOnly`.

**P6 [NIT] — export visibility of integration-point functions. ADDRESSED.** Note records `getForm`/`updateForm` exported, `getEditableForm`/`getFormForResponseAccess` private; visibility left unchanged (edits are in-file).

**P7 [NIT] — auto-ACCEPTED existing-user RESPONDER in shared-with-me. CONFIRMED (intended).** Documented as deliberate; role-specific exclusion lives only in the access helpers, never in `shared-with-me`.
