# Design Review — Per-Form Sharing + Email Invites (FormShare)

Reviewed document: `c:\Qivo\.agents\tasks\form-share-feature\design.md`
Reviewer: design-review subagent (fresh read, no authoring context)
Repo: `c:\Qivo`

This review reads the design on its own terms and spot-checks every load-bearing
claim against the real source. The design has already been through two prior
review passes; this pass independently re-verifies that the fixes it claims are
actually correct against the code, and looks for anything newly introduced or
still ambiguous.

---

## Verdict rationale

Every claim the design makes about existing signatures, control flow, the email
no-op, CSRF/Bearer handling, the notification enum, and the migration convention
was checked against source and holds. The five required design decisions are each
resolved with a single concrete answer. The effective-access resolution is
structured so the existing workspace query always runs first and unchanged, so no
workspace-role enforcement is weakened.

Two NIT-level gaps remain (missing `useLocation` import instruction for
`SignupPage`/`LoginPage`). Neither is HIGH or MEDIUM.

**HIGH: 0 — MEDIUM: 0 — NIT: 2 → verdict APPROVED.**

---

## Findings

### 1. [NIT] `SignupPage.tsx` / `LoginPage.tsx` need an explicit `useLocation` import, but the design only spells this out for `GuestOnly`

Where: "Signup → acceptance flow (web)" → `SignupPage.tsx` and `LoginPage.tsx`
subsections.

The design instructs reading the invite token via
`new URLSearchParams(useLocation().search).get("invite")` in both pages. Verified
against source:

- `SignupPage.tsx` imports only `{ Link, useNavigate }` from `react-router-dom`.
- `LoginPage.tsx` imports only `{ Link, useNavigate }` from `react-router-dom`.

Neither imports `useLocation`. The design explicitly calls out adding the import
for `GuestOnly` (finding #3 in its own log) and for `AuthGuard` (already imported
there), but does not state it for these two pages. An implementer copying the
snippet verbatim would hit a compile error (`Cannot find name 'useLocation'`).

Concrete fix: add to the `SignupPage`/`LoginPage` subsections:
"Change the import to `import { Link, useNavigate, useLocation } from
"react-router-dom"` and add `const location = useLocation();`, then read
`new URLSearchParams(location.search).get("invite")`."

### 2. [NIT] `LoginPage` has two post-auth redirect sites; the design says "password + Google" but should pin that `handleGoogleCallback` AND `handleSubmit` both change

Where: "Signup → acceptance flow (web)" → `LoginPage.tsx` subsection.

Verified: `LoginPage.tsx` has two independent `setToken(data.token);
navigate("/dashboard");` sites — one in `handleSubmit` (password) and one in
`handleGoogleCallback` (Google). The design does say "(password + Google)", so
the intent is captured, but the redirect logic (`navigate(inviteToken ?
\`/accept-invite?token=${...}\` : "/dashboard")`) must be duplicated into BOTH
functions, and `inviteToken` must be read once at component scope (not inside one
handler). Pinning this avoids an implementer wiring only the password path and
silently dropping the token for Google sign-up invitees.

Concrete fix: state "read `inviteToken` once at component top (from
`location.search`); apply the same `navigate(inviteToken ? '/accept-invite?token='
+ encodeURIComponent(inviteToken) : '/dashboard')` in both `handleSubmit` and
`handleGoogleCallback`."

---

## Verified Assumptions (checked against source, all correct)

1. **`getEditableForm(formId, userId)`** — `form.service.ts`: module-private
   `async function`, returns a form only when a non-VIEWER workspace member
   (`members: { some: { userId, role: { not: "VIEWER" } } }`), else throws
   `formNotFoundError("Form not found or not editable.")`. Matches the design's
   OR-fallback integration point exactly.

2. **`getForm(formId, userId)`** — exported; any-membership `findFirst`
   (`members: { some: { userId } }`), else `formNotFoundError()`. The design's
   claim that it is "any member may read the definition" is correct, and the
   `hasResponseViewShare`-gated fallback is a clean additive OR.

3. **`getFormForResponseAccess(formId, userId)`** — module-private; non-VIEWER
   member query, then a second `isMember` query to disambiguate 403 (member but
   VIEWER) vs 404 (non-member). The design's description of this two-stage shape
   and its decision to keep it (fallback only reached when neither path grants)
   is accurate.

4. **`updateForm(formId, userId, input)`** — exported; and the design's finding
   #2 is confirmed verbatim: there is an initial `findFirst` matching ANY
   membership (a non-member hits `null` → `FORM_NOT_FOUND` before any role check),
   and a later `membership.role === "VIEWER"` → `FORBIDDEN`. The core external-HOD
   editor-share case IS rejected at point (1) under a naive patch, exactly as the
   design states. The design's restructure (single non-VIEWER-member query + a
   fallback that runs whenever `form` is null) correctly covers both rejection
   points.

5. **Email no-op** — `email.ts`: `sendEmail` wraps everything in try/catch and
   `console.error`s without rethrowing ("Never throws to the caller"); when
   `getResendKey()` is falsy it calls `logToConsole` instead of hitting Resend.
   The design's "silent console no-op when `RESEND_API_KEY` is unset, never
   throws" is exact. `layout(...)`, `button(...)`, `getWebUrl()` helpers and the
   `sendTeamInviteEmail` template style all exist as referenced.

6. **Bearer vs CSRF** — `csrf.ts`: `csrfProtection(allowedOrigins)` returns
   middleware that lets through GET/HEAD/OPTIONS, any path containing `/public/`,
   and any request with an `Authorization: Bearer ` header; otherwise it requires
   a same-origin Origin/Referer. So `GET /api/invites/:token` (safe method) and
   `POST /api/invites/:token/accept` (Bearer) both pass with no `csrf.ts` edit —
   the design's "No edits to `csrf.ts` are required" is correct.

7. **`requireAuth` / `req.user` shape** — `auth.ts`: accepts cookie OR
   `Authorization: Bearer`, sets `req.user = { id, name, email }`. The design's
   `acceptInvite(token, user)` reading `user.email` and the email-match check are
   feasible exactly as written.

8. **`createNotification` signature** — `notification.service.ts`: accepts
   `{ userId, type, title, message, metadata? }`. The design's direct-call usage
   in `createShare` matches. The `messages`/`titles` maps are typed
   `Record<NotificationType, string>`, so adding `FORM_SHARED` to the union DOES
   require adding both map entries to keep the file compiling — the design's
   Notifications section correctly requires this.

9. **Members-module precedent withdrawal (design finding #4)** — `member.service.ts`:
   `inviteMember` indeed has NO new-user/invite-email path (it throws
   `USER_NOT_FOUND` if the user doesn't exist) and its `MEMBER_INVITED`
   `createNotification` call is `void createNotification({...})` with **no**
   `.catch()`. The design's decision to NOT copy that pattern and instead use
   `void <promise>.catch(console.error)` is well-founded and verified.

10. **`NotificationType` enum** — `schema.prisma` lists the eight existing values;
    `FORM_SHARED` is not present. Adding it is required and correctly scoped.

11. **Schema back-references & unique semantics** — `User` has `forms`,
    `notifications`, etc.; `Form` has relation arrays; adding `shares`,
    `formShares`, `formSharesInvited` is consistent with Prisma's both-sides
    requirement. The existing `@@unique([formId, respondentEmail])` with the
    "NULLs are distinct in Postgres unique indexes" comment confirms the project
    already relies on exactly the semantics the design's `@@unique([formId, email])`
    uses. The design's index set (unique `token`, unique `(formId,email)`,
    non-unique `formId`, non-unique `userId`) is internally consistent across the
    model block, prose, and migration SQL — no stray `FormShare_token_idx`, no
    `@@unique([formId, token])`.

12. **Migration convention** — `prisma/migrations/` exists; the latest folder is
    `20260925000000_add_google_id_and_respondent_email`, exactly as cited, and its
    `migration.sql` is hand-authored raw SQL with explanatory comments. The
    existing `add_notifications` migration shows the precise emitted style
    (`CREATE TYPE ... AS ENUM`, `TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    `_pkey`/`_key`/`_idx`/`_fkey` naming, `ON DELETE ... ON UPDATE CASCADE`) that
    the design's FormShare SQL mirrors. The two-folder split for the
    `ALTER TYPE ... ADD VALUE` hazard is sound.

13. **Token style** — `auth.service.ts` uses `randomBytes(32).toString("hex")`
    for session/reset/verify tokens; the design reuses this exact style for the
    share token. Correct.

14. **Route ordering (Option A)** — `form.routes.ts` registers `GET /:formId`
    after several literal routes (`/templates`, `/workspace-stats`, etc.), and
    `app.ts` currently mounts `formRouter` first at `/api/forms`. Express matches
    routers in registration order, so mounting `formShareRouter` (with
    `GET /shared-with-me` declared first) BEFORE `formRouter` makes
    `/api/forms/shared-with-me` resolve before `/:formId` swallows it; non-matching
    paths fall through to `formRouter`. The design's analysis is correct.

15. **`app.ts` error switch** — `INVALID_TOKEN`, `FORBIDDEN`, `FORM_NOT_FOUND`,
    `USER_NOT_FOUND` all exist; `SHARE_NOT_FOUND` does NOT. The design correctly
    lists adding only `SHARE_NOT_FOUND → 404`.

16. **Web API client** — `api.ts` exports `api.get/post/patch/delete`,
    `publicGet`, `setToken`, `getToken`, and `ApiRequestError` (with a `.code`
    field). The `AcceptInvitePage` use of `publicGet` for the public GET and
    `ApiRequestError.code` for error branching is valid. No new client functions
    are needed, as the design states.

17. **`App.tsx` `GuestOnly`** — verified it imports only `Navigate` (not
    `useLocation`) and reads only `getToken()`. The design's finding #3 fix
    (add `useLocation` + `const location = useLocation();`) is necessary and
    correctly scoped. `Protected` is a render-prop `(user) => ReactNode`; the
    design's `{() => <AcceptInvitePage />}` registration is compatible.

18. **`AuthGuard.tsx`** — verified the no-user branch is hard-coded
    `<Navigate to="/login" state={{ from: location.pathname }} replace />` with no
    query string, `useLocation` is already imported, and nothing in the app reads
    `state.from`. The design's finding #5 analysis (dead `state.from`, token must
    ride `?invite=`) is accurate, and its special-case fix is feasible as written.

### The five required decisions — each resolved with a concrete answer

1. **Enum vs string → ENUM.** Concrete: `FormShareRole`/`FormShareStatus` Prisma
   enums, full model given. Consistent with existing `WorkspaceRole`/`FormStatus`.
2. **Email-match on accept → REQUIRE.** Concrete: `acceptInvite` enforces
   `user.email.toLowerCase() === share.email` (share stored lowercased), 403 on
   mismatch. Verified feasible against `req.user.email`.
3. **"Shared with me" scope → IN SCOPE (endpoint + types; UI section deferred).**
   Concrete: `GET /api/forms/shared-with-me` returns ACCEPTED+linked shares for
   the user regardless of role; RESPONDER behavior pinned (auto-ACCEPTED existing
   user appears; PENDING new-user excluded until accept).
4. **`getEditableForm` integration that does NOT weaken workspace checks →
   OR-fallback after the unchanged workspace query.** Concrete code blocks for
   `getEditableForm`, `updateForm`, `getForm`, `getFormForResponseAccess`; the
   workspace query runs first and unchanged in every case; `deleteForm`/
   `publishForm` deliberately left workspace-only. Verified this cannot weaken
   enforcement: a VIEWER member never matches the non-VIEWER query, and only an
   explicit ACCEPTED EDITOR share adds edit for exactly one form.
5. **Acceptance routing when not logged in → carry `?invite=` with an `AuthGuard`
   special-case.** Concrete: unauthenticated `/accept-invite?token=T` →
   `/login?invite=T`; `Login`/`Signup` read `?invite=` and bounce to
   `/accept-invite?token=T`; `GuestOnly` handles already-logged-in; dead
   `state.from` dropped. Round-trip fully specified.

### Effective-access resolution does not weaken workspace enforcement — confirmed

In all four touched functions the existing workspace `findFirst` runs first and is
left intact (or folds the VIEWER exclusion INTO the query without loosening it).
The share path is a pure OR-fallback reached only when the workspace path returns
nothing, and only EDITOR shares reach write paths (`hasEditorShare`), only
EDITOR/VIEWER shares reach read/response paths (`hasResponseViewShare`), and
RESPONDER reaches none of the access helpers. A VIEWER workspace member cannot
gain edit via any path. This matches the stated invariant.

---

## Unverified / Wrong Assumptions

None. Every assumption the design makes about existing code was checked against
source and found correct. No claim in the design was contradicted by the
repository.

(One item I could not exhaustively trace — whether `listFormResponses` internally
calls `getFormForResponseAccess` — does not affect the review: the design edits
`getFormForResponseAccess` directly, and that function exists with exactly the
signature and two-stage 404/403 behavior the design describes. If the response
list path routes through a different gate, that would be a separate implementation
detail, not a design-document defect.)
