# Design — Email engagement features (Qivo)

## Overview

This design adds two per-form, Settings-panel email features to the Qivo form builder:

- **Feature A — Owner notification on new response.** A new `responseNotification` setting with three modes: `"off"` (default), `"immediate"` (email the form owner right after each response is saved), and `"daily"` (a once-per-24h digest to the owner summarizing responses in the last 24h, sent by a scheduled sweep).
- **Feature B — Respondent confirmation email.** A new `sendConfirmationEmail` boolean (default `false`) that, only when `collectEmail` is also on and the respondent supplied an email, sends the respondent a confirmation email after their response is saved.

Both features live entirely inside the existing form `schema.settings` JSON blob (no new per-setting columns, except possibly one bookkeeping column for the digest — see Decision 1). They reuse the existing `email.ts` Resend wrapper, which already silently falls back to console logging (and never throws) when `RESEND_API_KEY` is unset, so "no-op without Resend" is satisfied for free. Submit-path emails are fire-and-forget with a `.catch(console.error)` so they can never break a submission, exactly matching the existing analytics/milestone side-effect in `submitFormResponse()`.

The technology stack is locked to the existing one: TypeScript, Express, Prisma (PostgreSQL), Zod for input validation on the API; React + Vite on the web app; Resend (via `fetch`) for email. No new libraries are introduced.

---

## Technology stack (locked)

- **API:** Node + Express, Prisma client generated to `apps/api/src/generated/prisma`, Zod validation in `form.schemas.ts`.
- **Email:** existing `apps/api/src/services/email.ts` wrapper (`sendEmail` + `layout`/`button` template helpers). Resend when `RESEND_API_KEY` is set; console otherwise.
- **Scheduler:** the existing `setInterval` timer in `apps/api/src/server.ts` (`PUBLISH_SWEEP_MS = 60_000`).
- **Web:** React function component `FormEditorPage.tsx`, local `useState` settings mirrored into a PATCH payload.
- **Persistence:** form settings stored in `Form.schema` JSON. Digest bookkeeping either in the same JSON or in a new nullable `Form` column (Decision 1). Prisma lives at **repo root** `c:\Qivo\prisma\` (schema `c:\Qivo\prisma\schema.prisma`, migrations `c:\Qivo\prisma\migrations\`) — there is **no** `apps/api/prisma/` directory. The generator output `output = "../apps/api/src/generated/prisma"` is relative to the root `prisma/` dir.

---

## Decision 1 — Daily digest idempotency and "since when" storage

**Options considered.**

- **(a) Pure 24h window keyed off the timer.** On each sweep, count responses in `[now − 24h, now]` for every `daily` form and email if count > 0. No new storage.
- **(b) A `lastDigestSentAt DateTime?` column on `Form`.** On each sweep, select `daily` forms where `lastDigestSentAt` is null or older than ~24h, count responses since `lastDigestSentAt` (or since `now − 24h` if null), email if count > 0, then stamp `lastDigestSentAt = now`.

**Chosen: (b), `lastDigestSentAt DateTime?` on `Form`.**

**Why.** The publish/close sweep runs every 60 seconds (`PUBLISH_SWEEP_MS = 60_000`). Option (a) has no memory of whether a digest already went out, so it would re-send on *every* tick for any form that received a response in the trailing 24h window — roughly 1,440 duplicate digest emails per day per active form. The only way to make (a) safe is to fire the digest sweep on its own exact-24h timer and never drift, which is fragile across restarts (the process restarts on every Railway deploy, resetting the timer and re-sending). A persisted timestamp is the robust, restart-safe way to guarantee **at most one digest per ~24h per form** regardless of how frequently the 60s timer fires.

**How double-send within the same day is prevented.** `sendResponseDigests(now)` only treats a form as due when `lastDigestSentAt IS NULL OR lastDigestSentAt <= now − 24h` (a `DIGEST_INTERVAL_MS = 24h` threshold, with a small tolerance subtracted so a sweep that fires a few seconds before the exact 24h mark still qualifies — e.g. compare against `now − (24h − 60s)`). After a digest is emailed for a form, the sweep immediately stamps `lastDigestSentAt = now` on that `Form` row. The next tick 60 seconds later re-evaluates the same form, sees `lastDigestSentAt` is only ~60s old, and skips it. So across the 1,439 remaining ticks in the day the form is never re-selected. The stamp is written **only when an email was actually attempted** (count > 0); a day with zero responses leaves `lastDigestSentAt` unchanged so the window does not silently slide forward past un-notified responses.

**Concurrency note.** There is a single API process running one timer, and the initial boot sweep is the same `runPublishSweep` path; there is no multi-instance fan-out today. The stamp-after-send ordering is therefore sufficient. (If the deployment ever scales to multiple instances, this should become a conditional `updateMany` guarded on `lastDigestSentAt` to claim the row atomically — noted as a future hardening, not implemented now.)

**Migration.** `lastDigestSentAt` requires a schema + DB change. Deployment applies migrations with `prisma migrate deploy` (`pnpm db:migrate`), and migrations in `c:\Qivo\prisma\migrations\` are hand-authored raw SQL (see `c:\Qivo\prisma\migrations\20260822082301_add_workspace_branding\migration.sql`, an `ALTER TABLE … ADD COLUMN`, and `c:\Qivo\prisma\migrations\20260926000100_add_form_share\migration.sql`). Follow that convention exactly. (Note: do NOT run `prisma migrate deploy` against the shared/production DB during local verification — validating the schema + `pnpm db:generate` is sufficient to confirm the SQL is consistent with the model.)

- **New file (repo-root path):** `c:\Qivo\prisma\migrations\20260927000000_add_form_last_digest_sent_at\migration.sql`
  - The highest existing migration prefix is `20260926000100_add_form_share`; the chosen `20260927000000` sorts strictly after it (and after all other siblings such as `20260925000000_add_google_id_and_respondent_email`, `20260926000000_add_form_shared_notification_type`, `20260822114351_add_events`). Keep the `YYYYMMDDHHMMSS_snake_case` directory naming and the single `migration.sql` inside.
- **Exact SQL** (double-space between `ADD COLUMN` and the column name matches Prisma's generated style in the cited precedent; whitespace is cosmetic to Postgres):

```sql
-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3);
```

- **Schema change** in `c:\Qivo\prisma\schema.prisma`, `Form` model — add alongside the other scalar fields (e.g. after `deletedAt`):

```prisma
  lastDigestSentAt DateTime?
```

No index is needed: the `daily`-form set is small and already filtered in application code after loading `schema`, and the sweep scans forms the same way `publishDueForms()`/`closeDueForms()` already do.

---

## Decision 2 — Public payload handling

`getPublicForm()` **does send `settings` wholesale** today: it returns `schema: { version, sections: stripAnswerKeys(...), settings: schema.settings, confirmationMessage? }`. That means any field added to `settings` would leak to anonymous respondents unless explicitly stripped.

- `responseNotification` is **owner-facing** and MUST NOT appear in the public payload. It must be stripped.
- `sendConfirmationEmail` is a server-side behavior toggle and carries no secret, but it is likewise irrelevant to a respondent and is of the same owner-config nature, so for a clean, intentional public contract it is **also stripped**. The public form never needs to know either flag.

**Implementation approach.** In `getPublicForm()`, instead of passing `schema.settings` through directly, build a `publicSettings` object by destructuring off the owner-only keys:

```
const { responseNotification, sendConfirmationEmail, ...publicSettings } = schema.settings;
void responseNotification; void sendConfirmationEmail; // intentionally dropped from public payload
```

and return `settings: publicSettings`. This mirrors the existing `stripAnswerKeys` pattern (destructure-and-`void` to signal intentional omission). The public settings that remain (`collectEmail`, `allowMultipleResponses`, `scheduledPublishAt`, `scheduledCloseAt`, `quizMode`, `showScore`) are unchanged — the respondent flow already depends on `collectEmail` (to require an email) and `quizMode`/`showScore`.

---

## Decision 3 — Digest content depth

**Chosen: lean (v1).** The digest email contains: the form title, the count of responses in the last 24h, and a button/link to the form's responses page (`${WEB_URL}/forms/${formId}/responses`, the same destination the existing `sendFormShareExistingUserEmail` uses for the VIEWER role). No per-response answer rendering in the digest. This keeps the email small, avoids leaking large volumes of respondent data over email, and is enough for the owner to decide whether to open the dashboard. A richer digest (sample answers, per-question breakdown) can be a later iteration.

---

## Decision 4 — Confirmation email answer-copy

**Chosen: a simple question label → answer list, defensively rendered.** The confirmation email to the respondent includes the form title, a short "thanks" line, and an optional list of their submitted answers rendered as `Question label: answer`. Defensive rendering rules (see Feature B below) handle arrays (`MULTI_ENTRY`, `MULTIPLE_CHOICE`), file URLs (`FILE_UPLOAD`), booleans (`YES_NO`), numbers, and empty/skipped questions. This is "nice to have" copy; if rendering a particular answer is awkward, the field is simply omitted rather than throwing — the email still sends with whatever rendered cleanly.

---

## Settings-field additions (shared shape)

All changes to the settings shape are made in three places that must stay in lockstep, exactly as the existing fields are threaded through.

### `apps/api/src/modules/forms/form.service.ts`

1. **`FormSchema` type** — extend `settings`:

```
settings: {
  collectEmail: boolean;
  allowMultipleResponses: boolean;
  scheduledPublishAt?: string | null;
  scheduledCloseAt?: string | null;
  quizMode?: boolean;
  showScore?: boolean;
  responseNotification?: "off" | "immediate" | "daily";   // NEW
  sendConfirmationEmail?: boolean;                          // NEW
};
```

2. **`getFormSchema()` allow-list + defaulting (LOAD-BEARING, not optional)** — add the two fields to the returned `settings`:

   - `responseNotification`: default to `"off"`. Because this has a concrete default (unlike the optional `scheduledPublishAt`), include it unconditionally: `responseNotification: candidate?.settings?.responseNotification ?? "off"`.
   - `sendConfirmationEmail`: default to `false`: `sendConfirmationEmail: candidate?.settings?.sendConfirmationEmail ?? false`.

   Defaulting `responseNotification` to `"off"` and `sendConfirmationEmail` to `false` guarantees existing forms (whose stored JSON has neither key) behave exactly as today — no emails.

   **Why this edit is mandatory, not just defaulting sugar:** `getFormSchema` re-emits only a fixed *allow-list* of settings keys (`collectEmail`, `allowMultipleResponses`, and conditional `scheduledPublishAt`/`scheduledCloseAt`/`quizMode`/`showScore`). Any key NOT in that list is silently dropped on every read. So without adding `responseNotification` and `sendConfirmationEmail` to this allow-list, the values written by `updateFormSettings` would be lost on the next read. The implementer MUST NOT skip this edit.

3. **`updateFormSettings()` merge** — add the two conditional spreads alongside the existing ones, inside the merged `settings` object:

```
...(input.responseNotification !== undefined
  ? { responseNotification: input.responseNotification }
  : {}),
...(input.sendConfirmationEmail !== undefined
  ? { sendConfirmationEmail: input.sendConfirmationEmail }
  : {}),
```

### `apps/api/src/modules/forms/form.schemas.ts`

Extend `updateFormSettingsSchema`:

```
responseNotification: z.enum(["off", "immediate", "daily"]).optional(),
sendConfirmationEmail: z.boolean().optional(),
```

Both `.optional()` so a PATCH that omits them leaves the stored value untouched (consistent with how `quizMode`/`showScore` behave). `UpdateFormSettingsInput` picks these up automatically via `z.infer`.

**Validation rules for these two external inputs:**

- `responseNotification`: optional; type string constrained to the enum `off|immediate|daily`. On a value outside the enum, Zod rejects the whole PATCH with a 400 (the existing route error-handling path). No coercion.
- `sendConfirmationEmail`: optional; type boolean. Non-boolean → 400. No coercion.
- Cross-field rule (`sendConfirmationEmail` only meaningful when `collectEmail` is on): **not enforced at the schema layer.** The owner may toggle `sendConfirmationEmail` on while `collectEmail` is off (e.g. configuring ahead of time). The invariant is enforced at **send time** in `submitFormResponse()` (see Feature B), which is the only place it matters — a confirmation can only be sent if an email was actually collected. The UI additionally disables the checkbox when `collectEmail` is off as a usability guard (see Frontend). Enforcing it at send time (not validation time) is the right owner: it is the layer that has the respondent's actual email in hand and is the single authority that decides whether a mail goes out.

---

## Feature A — Owner notification on new response

### A.1 Immediate mode (submit path)

**File:** `apps/api/src/modules/forms/form.service.ts`, inside `submitFormResponse()`.

**Placement.** After the `prisma.formResponse.create(...)` row is created and the existing fire-and-forget analytics/milestone block runs (the `void (async () => { … })().catch(...)` for `formAnalytics`/`RESPONSE_MILESTONE`). Add a new, independent fire-and-forget block so it neither blocks nor is blocked by the existing side-effects, and so an email failure cannot affect the milestone logic or the function's return value.

**Behavior.** When `schema.settings.responseNotification === "immediate"`:

- Fetch the owner's email: `prisma.user.findUnique({ where: { id: form.ownerId }, select: { email: true, name: true } })`. (The `Form.owner` relation to `User` carries `email`.)
- Call a new `sendNewResponseNotificationEmail(ownerEmail, { formTitle, formId })` in `email.ts`.
- Wrap the whole block in `void (async () => { … })().catch((err) => console.error("response notification email failed:", err));`.

Because `sendEmail` already no-ops (console-logs) without `RESEND_API_KEY` and never throws, the "no-op without Resend" and "never break submission" requirements are met. The email send is *not* awaited by the request — the response is returned to the respondent immediately.

**Content.** Subject like `New response to "<formTitle>"`. Body: a one-liner plus a button to `${WEB_URL}/forms/${formId}/responses`. Lean, same template helpers (`layout`/`button`) as the other emails.

### A.2 Daily digest (scheduled sweep)

**File:** `apps/api/src/modules/forms/form.service.ts` — new exported function.

**Signature:**

```
export async function sendResponseDigests(now: Date = new Date()): Promise<number>
```

Returns the number of digests actually sent (for the scheduler log line), mirroring the `publishDueForms`/`closeDueForms` return-count convention.

**Algorithm.**

1. Define `const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;` and a small tolerance (e.g. `const DIGEST_TOLERANCE_MS = 60_000;`).
2. Load candidate forms: `prisma.form.findMany({ where: { deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } }, select: { id, title, ownerId, schema, lastDigestSentAt } })`. (Include `CLOSED` so an owner still gets a digest for the final day's responses on a form that auto-closed; exclude archived/draft.)
3. Filter in application code (same style as `publishDueForms`): keep forms where `getFormSchema(f.schema).settings.responseNotification === "daily"` **and** (`f.lastDigestSentAt == null` **or** `f.lastDigestSentAt.getTime() <= now.getTime() - (DIGEST_INTERVAL_MS - DIGEST_TOLERANCE_MS)`).
4. For each due form, define the window start: `since = f.lastDigestSentAt ?? new Date(now.getTime() - DIGEST_INTERVAL_MS)` (i.e. a never-before-digested form counts only its trailing 24h, not its entire history). Count responses: `prisma.formResponse.count({ where: { formId: f.id, submittedAt: { gt: since, lte: now } } })`.
5. If `count > 0`:
   - Look up the owner email once per form: `prisma.user.findUnique({ where: { id: f.ownerId }, select: { email: true, name: true } })`.
   - `await sendResponseDigestEmail(ownerEmail, { formTitle: f.title, formId: f.id, count })`.
   - Stamp: `prisma.form.update({ where: { id: f.id }, data: { lastDigestSentAt: now } })`.
   - Increment the sent counter.
6. If `count === 0`, do **not** send and do **not** stamp (so the window does not slide past un-notified responses, per Decision 1).
7. Wrap each form's processing in a try/catch so one owner's bad email or lookup failure does not abort the whole sweep; log and continue.

**Timer wiring.** `apps/api/src/server.ts`, inside `runPublishSweep()` (the function already invoked by `publishTimer` every `PUBLISH_SWEEP_MS` and by the boot `setTimeout`). Add, alongside the existing publish/close calls:

```
const digests = await sendResponseDigests();
if (digests > 0) console.log(`[scheduler] sent ${digests} response digest(s)`);
```

Import `sendResponseDigests` next to the existing `publishDueForms, closeDueForms` import. **`sendResponseDigests` must stay defined in `form.service.ts`** because it calls the module-private `getFormSchema` (not exported); `server.ts` imports only `sendResponseDigests`, never `getFormSchema`. No new timer is introduced — reusing the single existing sweep is exactly why `lastDigestSentAt` (not a dedicated 24h timer) is the idempotency mechanism. The 60s cadence is fine because the `lastDigestSentAt` guard makes the per-form send rate independent of the sweep rate.

---

## Feature B — Respondent confirmation email

**File:** `apps/api/src/modules/forms/form.service.ts`, inside `submitFormResponse()`.

**Placement.** Same region as Feature A.1 — after the response row is created, as an independent fire-and-forget block.

**Guard (invariant enforcement).** Send only when **all** hold:

- `schema.settings.sendConfirmationEmail === true`, and
- `schema.settings.collectEmail === true`, and
- a respondent email is present.

Reuse the already-computed `normalizedEmail` (the lowercased/trimmed email used for duplicate detection) as the recipient, rather than re-deriving from `input.email`. This is the layer that owns the "only when email collected" invariant because it is the only place that has the concrete respondent email.

**Behavior.** When the guard passes:

- Build a defensive answer list from `schema.sections.flatMap(s => s.questions)` and `input.answers`.
- Call a new `sendResponseConfirmationEmail(normalizedEmail, { formTitle, formId, slug, answers })` in `email.ts`.
- Wrap in `void (async () => { … })().catch((err) => console.error("confirmation email failed:", err));`.

No-op without Resend is automatic via `sendEmail`.

**Defensive answer rendering** (used to build the label→value list passed to the template; keep it tolerant — never throw):

| Answer shape | Render as |
|---|---|
| `undefined` / `null` / `""` | omit the question entirely |
| array (e.g. `MULTI_ENTRY`, multi-select) | filter out empty entries, join non-empty with `", "`; omit if all empty |
| file URL string (`FILE_UPLOAD`, matches `^https?://`) | render the URL as a link (or plain text in the text/plain part) |
| `YES_NO` (reaches the blob as a real boolean OR the strings `"yes"`/`"no"` — `validateAnswerAgainstQuestion` accepts both) | normalize both shapes: `value === true \|\| value === "yes"` → `"Yes"`; `value === false \|\| value === "no"` → `"No"` |
| number | `String(value)` |
| plain string | the string, HTML-escaped for the HTML part |

Match questions to answers by `question.id`; label comes from `question.label`. If a question has no answer, skip it. HTML-escape all respondent-supplied values before interpolation into the HTML body to avoid broken/injected markup in the email.

**Content.** Subject like `Thanks for your response to "<formTitle>"`. Body: a thank-you line, the optional answer list, and (optionally) a link back to the public form `${WEB_URL}/f/${slug}`. Uses the existing `layout`/`button` helpers.

---

## Email service additions

**File:** `apps/api/src/services/email.ts`. Add three new exported functions matching the existing style (each builds a payload and calls the shared `sendEmail`, which handles the Resend/console/never-throw behavior). Reuse `layout`, `button`, `getWebUrl`.

1. `sendNewResponseNotificationEmail(to: string, opts: { formTitle: string; formId: string }): Promise<void>` — immediate owner notification. Link to `${webUrl}/forms/${opts.formId}/responses`.
2. `sendResponseDigestEmail(to: string, opts: { formTitle: string; formId: string; count: number }): Promise<void>` — daily digest. Mentions `opts.count` new responses in the last 24 hours; link to `${webUrl}/forms/${opts.formId}/responses`.
3. `sendResponseConfirmationEmail(to: string, opts: { formTitle: string; formId: string; slug: string; answers: Array<{ label: string; value: string }> }): Promise<void>` — respondent confirmation. Renders the pre-sanitized `answers` list (the defensive rendering in Feature B produces plain strings; this function only lays them out). Link to `${webUrl}/f/${opts.slug}`.

All three rely on `sendEmail`'s built-in guarantees: silent console fallback when `RESEND_API_KEY` is unset, and swallow-and-log on provider failure. None of them should throw.

---

## Frontend changes

**File:** `apps/web/src/pages/FormEditorPage.tsx`. **Do not touch** `toIsoInstant` / `toDatetimeLocal` or the schedule inputs.

### State

Add two state hooks next to the existing settings state:

```
const [responseNotification, setResponseNotification] =
  useState<"off" | "immediate" | "daily">("off");
const [sendConfirmationEmail, setSendConfirmationEmail] = useState(false);
```

### Load (in `loadEditor`, next to the other `setX(schema.settings?....)` calls)

```
setResponseNotification(schema.settings?.responseNotification ?? "off");
setSendConfirmationEmail(schema.settings?.sendConfirmationEmail ?? false);
```

The web-side settings type (the `settings` object inside the form/schema type in **`c:\Qivo\apps\web\src\types\index.ts`**, which already lists `collectEmail`, `allowMultipleResponses`, `scheduledPublishAt?`, `scheduledCloseAt?`, `quizMode?`, `showScore?`) must also gain the two optional fields so TypeScript accepts the reads:

```
responseNotification?: "off" | "immediate" | "daily";
sendConfirmationEmail?: boolean;
```

### Save (in `saveFormSettings`, add to the PATCH body)

```
responseNotification,
sendConfirmationEmail,
```

These go into the same `api.patch("/api/forms/${formId}/settings", { … })` payload as the existing fields — no new endpoint.

### UI controls

Place both in the existing **Collection** `SettingsGroup` (they are collection/response-handling concerns), using the existing control styling.

1. **"Email me about new responses"** — a `<select>` bound to `responseNotification` with three options: `Off`, `Immediately`, `Daily digest`. Use the same `question-field` label/select treatment as the scheduled-publish fields (or a `settings-toggle`-adjacent row). On change, `setResponseNotification(e.target.value as ...)`.

2. **"Send respondents a confirmation email"** — a `settings-toggle` checkbox bound to `sendConfirmationEmail`, structured like the existing `collectEmail`/`allowMultipleResponses` toggles. **Disabled/greyed when `collectEmail` is false**, with a hint in the `<small>` such as "Turn on 'Collect email addresses' to enable." i.e. `disabled={!collectEmail}` on the input, and when disabled the control reads muted. The checkbox's rendered value should still reflect `sendConfirmationEmail`; disabling only prevents changing it while email collection is off. (The server independently refuses to send if `collectEmail` is off, so a stale `true` stored value is harmless.)

Update the group `summary` string if desired to reflect the notification mode (optional, cosmetic).

---

## Error handling (per operation that can fail)

| Operation | Failure condition | Recoverable? | Caller receives | Logged |
|---|---|---|---|---|
| Settings PATCH validation (`updateFormSettingsSchema`) | bad enum / non-boolean | n/a (rejected) | 400 via existing route error path | existing path |
| Owner lookup for immediate/digest email | owner row missing / DB error | yes — skip that email | nothing (fire-and-forget) | `console.error` in the block's `.catch` / per-form try-catch |
| Immediate notification send | Resend failure / network | yes — submission already saved | nothing; response returns normally | `sendEmail` logs; block `.catch` logs |
| Confirmation send | Resend failure / bad answer render | yes — submission already saved | nothing | `sendEmail` logs; block `.catch` logs |
| Digest count query | DB error for one form | yes — skip that form, continue sweep | n/a | per-form try-catch `console.error` |
| Digest email send | Resend failure | yes — `lastDigestSentAt` **not** stamped, retried next tick... | n/a | logged |
| `lastDigestSentAt` stamp update | DB error | the digest may re-send next tick (at-least-once, acceptable) | n/a | logged |
| Migration apply (`prisma migrate deploy` / `pnpm db:migrate`) | SQL error | fatal (deploy fails) | n/a | deploy logs |

Note the digest "send then stamp" ordering is deliberately **at-least-once**: if the email send succeeds but the stamp update fails, the next tick may re-send one duplicate digest. That is strictly safer than "stamp then send" (which could silently drop a digest on send failure). Given the 24h cadence and single process, a rare duplicate is acceptable; silent loss is not.

---

## Edge cases

- **Existing forms with no new keys in stored JSON** — `getFormSchema` defaults `responseNotification="off"`, `sendConfirmationEmail=false`; behavior unchanged, no emails.
- **`sendConfirmationEmail=true` but `collectEmail=false`** — guard in `submitFormResponse` refuses to send (no respondent email); UI also disables the toggle. Stored stale `true` is harmless.
- **`collectEmail=true` but respondent still has no email** — cannot happen for confirmation because `collectEmail` already hard-requires an email earlier in `submitFormResponse` (`EMAIL_REQUIRED`); the guard's "email present" check is belt-and-suspenders.
- **Owner email missing/unverified** — email simply isn't sent; logged. No user-facing error (fire-and-forget).
- **Daily digest for a `CLOSED` form** — included so the final day's responses still produce one last digest; after the window with zero new responses it naturally stops (count 0 → no send, no stamp).
- **Process restart between sweeps** — `lastDigestSentAt` persisted in Postgres, so idempotency survives restarts/deploys (unlike a pure in-memory timer).
- **`RESEND_API_KEY` unset (dev / expired plan)** — every email path console-logs and no-ops; no feature breaks.
- **Timer fires during a long previous sweep** — `runPublishSweep` is already fire-and-forget per tick; the `lastDigestSentAt` guard prevents double digests even if two sweeps briefly overlap in the common single-process case. (Multi-instance atomic claim noted as future work.)
- **Respondent answers containing HTML/script** — HTML-escaped before interpolation in the confirmation email body.

---

## Testability

**Unit-testable (pure/dependency-injectable):**

- `getFormSchema` defaulting for the two new keys (pass raw JSON, assert defaults).
- `updateFormSettings` merge (assert new keys merged, omitted keys untouched).
- Public-payload stripping — call `getPublicForm`'s settings-building logic and assert `responseNotification`/`sendConfirmationEmail` absent (may require extracting the strip into a small pure helper to test without a DB, mirroring `stripAnswerKeys`, which is already a standalone function).
- Defensive answer-rendering helper for the confirmation email — pure function over `(questions, answers)`; table-test arrays, file URLs, booleans, numbers, empties.
- `sendResponseDigests` due-selection + window math — inject `now`; with a mocked Prisma client, assert which forms are selected given various `lastDigestSentAt` values and that a form is skipped on the next `now` just after stamping.

**Integration-testable:**

- `submitFormResponse` fires the immediate/confirmation side-effects (spy on `sendEmail`) and still returns normally when the email throws.
- Settings PATCH round-trip through the route with Zod.
- `sendResponseDigests` against a test DB: seed responses + `lastDigestSentAt`, run twice with close `now` values, assert exactly one email and one stamp.
- Migration SQL is consistent with the model: validate with `pnpm db:generate` (and schema validation) rather than applying `prisma migrate deploy` against a shared/production DB. If a disposable local DB is available, `pnpm db:migrate` applies the folder and the `lastDigestSentAt` column should exist.

**Design-for-test note.** The two submit-path side-effects are isolated `void (async()=>{})().catch(...)` blocks calling named `email.ts` functions, so tests can spy on those functions without exercising Resend. Extracting the confirmation answer-rendering and the public-settings strip as small pure helpers keeps the hardest-to-DB-test logic unit-testable — consistent with the existing `stripAnswerKeys`/`isAnswerCorrect`/`validateAnswerAgainstQuestion` helpers already factored out in this file.

---

## File-by-file change summary

- **`c:\Qivo\prisma\schema.prisma`** (repo root) — add `lastDigestSentAt DateTime?` to `Form`. Regenerate the client with `pnpm db:generate` after the edit.
- **`c:\Qivo\prisma\migrations\20260927000000_add_form_last_digest_sent_at\migration.sql`** (new, repo root) — `ALTER TABLE "Form" ADD COLUMN     "lastDigestSentAt" TIMESTAMP(3);`.
- **`apps/api/src/modules/forms/form.schemas.ts`** — add `responseNotification` enum + `sendConfirmationEmail` boolean (both optional) to `updateFormSettingsSchema`.
- **`apps/api/src/modules/forms/form.service.ts`** — extend `FormSchema.settings` type; default both keys in `getFormSchema`; merge both in `updateFormSettings`; strip both in `getPublicForm`; add immediate-notification and confirmation fire-and-forget blocks in `submitFormResponse`; add exported `sendResponseDigests(now)`.
- **`apps/api/src/services/email.ts`** — add `sendNewResponseNotificationEmail`, `sendResponseDigestEmail`, `sendResponseConfirmationEmail`.
- **`apps/api/src/server.ts`** — import `sendResponseDigests`; call it inside `runPublishSweep` with a log line.
- **`c:\Qivo\apps\web\src\types\index.ts`** — add the two optional fields (`responseNotification?`, `sendConfirmationEmail?`) to the form `settings` type so the editor reads typecheck.
- **`apps/web/src/pages/FormEditorPage.tsx`** — add `responseNotification`/`sendConfirmationEmail` state, load, save-payload, and the two Collection-group controls (select + conditionally-disabled checkbox). Do not alter the schedule datetime helpers.

---

## Responses to design review findings

Review: `c:\Qivo\.agents\tasks\email-engagement\design-review.md`; verdict `CHANGES_REQUESTED` (2 MEDIUM, 6 NIT).

1. **(MEDIUM) Wrong Prisma paths implying `apps/api/prisma/`.** ADDRESSED. Verified via directory listing that Prisma lives only at repo root `c:\Qivo\prisma\` and `apps/api/prisma/` does not exist. Qualified every Prisma reference with the explicit repo-root absolute path: schema `c:\Qivo\prisma\schema.prisma`, migration `c:\Qivo\prisma\migrations\20260927000000_add_form_last_digest_sent_at\migration.sql` (Technology stack/Persistence, Decision 1, file-by-file summary), and noted the generator-output relativity.
2. **(MEDIUM) Migration timestamp-prefix justification mislabels the latest migration.** ADDRESSED. Reworded Decision 1 to "the highest existing migration prefix is `20260926000100_add_form_share`; the chosen `20260927000000` sorts strictly after it," and enumerated the other siblings so ordering verification is unambiguous. Filename unchanged.
3. **(NIT) ALTER TABLE double-space SQL style.** NO CHANGE NEEDED; added an inline note that the double-space is Prisma's generated style and cosmetic to Postgres, keeping the proposed SQL as-is.
4. **(NIT) `getFormSchema` is module-private; keep `sendResponseDigests` in `form.service.ts`.** ADDRESSED by reinforcing in the timer-wiring section that `sendResponseDigests` stays in `form.service.ts` (so it can reach private `getFormSchema`) and `server.ts` imports only `sendResponseDigests`.
5. **(NIT) `getFormSchema` allow-list drop makes the settings addition load-bearing.** ADDRESSED. Relabeled the `getFormSchema` edit as "LOAD-BEARING, not optional" and explained that unknown settings keys are dropped on every read, so adding the two keys to the allow-list is mandatory for persistence.
6. **(NIT) Confirmation email `slug` source available.** NO CHANGE NEEDED; confirmed `submitFormResponse` loads the full form row so `form.slug` is in hand (already reflected in Feature B).
7. **(NIT) `YES_NO` render must handle boolean and yes/no string.** ADDRESSED. Updated the defensive-rendering table to normalize both shapes explicitly: `true`/`"yes"` → `"Yes"`, `false`/`"no"` → `"No"`.
8. **(NIT) Digest `since`-default.** ADDRESSED. Made A.2 step 4 concrete: `since = f.lastDigestSentAt ?? new Date(now.getTime() - DIGEST_INTERVAL_MS)`.

Also incidentally tightened: replaced the unverified "entrypoint runs `prisma migrate deploy` on boot" phrasing with the verified apply path (`pnpm db:migrate` / `prisma migrate deploy`) plus the do-not-run-against-production caveat; pinned the web-side settings type location to `c:\Qivo\apps\web\src\types\index.ts`.
