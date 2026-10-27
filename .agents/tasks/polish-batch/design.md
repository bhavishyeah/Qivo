# Polish Batch — Technical Design

## Overview

This batch adds three polish features to the Qivo form builder (React + Vite web in `apps/web`, Express + Prisma API in `apps/api`):

1. **Per-form theme / Appearance tab** — a `theme` object stored inside `schema.settings` (cover image, accent color, background, Google font), threaded through the public payload and surfaced in a new editor tab with a live preview.
2. **Same-session secure response editing** — a per-form `responseEditing` mode (`disabled` / `timed` / `until_close`) that lets a respondent overwrite their just-submitted response, authorized by a **stateless HMAC edit token** returned from the submit endpoint.
3. **Array answers as chips** — display-only chip rendering for array answers in the response dashboard and reports page; exports stay comma-joined.

All three are designed to require **no Prisma migration**: theme lives in the existing `schema` JSON, the edit marker lives in the existing `FormResponse.metadata` JSON, and the edit token is stateless (HMAC), so no new column is needed. The one new environment variable (`RESPONSE_EDIT_SECRET`) is optional with a dev fallback.

The locked technology stack is unchanged: TypeScript throughout, Express + Prisma (Postgres) on the API, React 18 + Vite + React Router on the web, Zod for request validation, Node's built-in `node:crypto` for signing (already used by `cloudinary.ts`), Cloudinary for uploads, and Resend for email. No new **runtime** dependencies are introduced. One new **dev** dependency (Vitest on the API — see §0) is required, because Feature 2 ships security-critical HMAC token code that must have executable unit tests.

---

## §0 — Prerequisite: API test runner (Vitest)

**Problem (verified, review Finding 2):** `apps/api/package.json` has `"test": "echo \"Error: no test specified\" && exit 1"` — the API has **no** test runner, config, or test files. The web app already has Vitest (`apps/web/package.json` → `"test": "vitest run"`, `vitest@^3.2.4`). Feature 2's token model (`signEditToken`/`verifyEditToken`) is the security core of the whole feature; its guarantees (reject forged / tampered / expired / responseId-mismatched tokens) are untestable as the API stands.

**Pinned decision:** add Vitest to `apps/api` as the **first implementation step**, so the Feature-1 schema tests and the Feature-2 token tests prescribed in §1.10 and §2.10 are runnable. Concretely:

- Add dev deps to `apps/api`: `vitest` (pin to the same major as web: `^3.2.4`) and nothing else — Vitest bundles its own TS transform, and the API already has `typescript`.
- Add script: `"test": "vitest run"` (replacing the stub) and optionally `"test:watch": "vitest"`.
- Add `apps/api/vitest.config.ts` with `test: { environment: "node", include: ["src/**/*.test.ts"] }`. No DOM env is needed (API is pure Node).
- Co-locate tests as `*.test.ts` next to the unit under test (e.g. `src/services/responseEditToken.test.ts`, `src/modules/forms/form.schemas.test.ts`). These are **pure-function** tests (token sign/verify, Zod schema parse) — they do **not** touch Postgres, so no DB harness or `DATABASE_URL` is required.

Tests that would require a live DB or full HTTP stack (the "Integration" bullets in §1.10/§2.10) are **descoped from this batch's automated suite** and listed instead as a manual verification checklist (§2.11), because standing up a Postgres test harness is out of scope for a polish batch. The security-critical guarantees are covered by the pure-function unit tests, which is the part that must not ship unverified. This is the pinned split: **unit = automated (Vitest), integration = manual checklist.**

---

## Feature 1 — Per-form theme / Appearance tab

### 1.1 Storage shape (no migration)

The theme is a new optional `theme` object inside `schema.settings`. Existing forms have no `theme` key, so `getFormSchema()` leaves it `undefined` and every resolution path falls back to today's behavior — existing forms render **exactly** as before.

```ts
// form.service.ts — extend the FormSchema settings type
type FormTheme = {
  coverImageUrl?: string;   // banner image (Cloudinary secure_url or pasted URL)
  accentColor?: string;     // overrides workspace primaryColor for THIS form
  backgroundColor?: string; // page background (hex)
  fontFamily?: string;      // one of FONT_ALLOW_LIST (exact family name)
};

type FormSchema = {
  version: number;
  sections: FormSection[];
  settings: {
    collectEmail: boolean;
    allowMultipleResponses: boolean;
    // ...existing fields...
    theme?: FormTheme; // NEW — undefined means "inherit workspace / defaults"
    responseEditing?: "disabled" | "timed" | "until_close"; // Feature 2
    responseEditMinutes?: number;                            // Feature 2
  };
  confirmationMessage?: string;
};
```

**`getFormSchema()` default:** do **not** fabricate a `theme` object. Only copy it through when present, mirroring the existing conditional-spread pattern used for `scheduledPublishAt`/`quizMode`:

```ts
...(candidate?.settings?.theme !== undefined
  ? { theme: candidate.settings.theme }
  : {}),
```

Rationale: an absent `theme` is the signal to inherit. Defaulting it to `{}` would be harmless but adds noise to stored JSON and to every public payload; keeping it absent keeps old forms byte-identical.

### 1.2 Zod validation (`updateFormSettingsSchema`)

Add a nested optional object. Colors are validated as hex strings; `fontFamily` must be in the allow-list; `coverImageUrl` must be an http(s) URL and length-capped. `.optional()` at the object and every field level so a partial PATCH can set one property without clearing the rest.

```ts
const HEX_COLOR = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex color");

export const FONT_ALLOW_LIST = [
  "Inter",
  "Roboto",
  "Poppins",
  "Montserrat",
  "Open Sans",
  "Lora",
  "Playfair Display",
  "Source Sans 3",
] as const;

// z.strictObject rejects unknown keys so a crafted PATCH can't smuggle extra JSON.
// Use z.strictObject (NOT z.object(...).strict(), which is deprecated in Zod v4 —
// both apps are on zod@^4.4.3).
const themeSchema = z
  .strictObject({
    coverImageUrl: z.string().trim().url().max(2000).optional(),
    accentColor: HEX_COLOR.optional(),
    backgroundColor: HEX_COLOR.optional(),
    fontFamily: z.enum(FONT_ALLOW_LIST).optional(),
  })
  .optional();

// inside updateFormSettingsSchema:
theme: themeSchema,
```

**Validation rules per field (external input):**

| Field | Required | Type | Limits | On failure |
|---|---|---|---|---|
| `coverImageUrl` | optional | string URL | http(s), ≤ 2000 chars | Zod 400 `VALIDATION_ERROR` |
| `accentColor` | optional | hex string | `#rgb` / `#rrggbb` | Zod 400 |
| `backgroundColor` | optional | hex string | `#rgb` / `#rrggbb` | Zod 400 |
| `fontFamily` | optional | enum | must equal an allow-list family | Zod 400 |

The font allow-list is **the** invariant that must be enforced server-side (Feature 1's only injection surface, since `fontFamily` flows into a stylesheet `href`). The Zod `z.enum` on the API is the enforcing layer — the client dropdown is convenience only. The web mirror of `FONT_ALLOW_LIST` lives in `apps/web/src/lib/theme.ts` (new) and must stay in sync; the server enum is authoritative. The two-copy duplication and its sync guard are pinned in §1.11.

Design note on empty-string clearing: `z.string().url()` rejects `""`, so "clear the cover image" is expressed by sending `coverImageUrl: undefined` (omit the key) rather than an empty string. The editor's "Remove cover" button therefore PATCHes a `theme` object without `coverImageUrl`. Because the merge (below) is a **whole-object replace**, omitting a field clears it.

### 1.3 Merge semantics in `updateFormSettings`

The existing settings merge is per-field conditional spread. For `theme`, use a **whole-object replace when `theme` is present in the input**, matching how the editor always sends the complete current theme in its settings PATCH:

```ts
...(input.theme !== undefined ? { theme: input.theme } : {}),
```

Rationale: the Appearance tab holds the full theme in local state and sends it entire on save, so replace-on-present is simpler and makes "remove cover image" (omit the field) work naturally. A deep per-field merge would make clearing a field impossible without a sentinel. The existing scalar settings (`collectEmail`, etc.) keep their current per-field conditional spread; only `theme` (and `responseEditing`/`responseEditMinutes`) are added.

### 1.4 Public payload (`getPublicForm`)

`getPublicForm()` already destructures owner-only fields out of `publicSettings` and re-emits a curated `settings`. `theme` is **respondent-relevant** (it drives rendering), so it flows through untouched as part of `publicSettings`. The existing `branding` object (workspace `name`/`logoUrl`/`primaryColor`) **stays in the payload** so the client can fall back.

No code change is needed beyond letting `theme` ride along in `publicSettings` — it is not in the destructured omit-list. Confirm `responseNotification`/`sendConfirmationEmail` stay omitted (they already are) and that `theme` is **not** added to that omit-list.

### 1.5 Resolution rule (public + preview)

Resolution runs on both `PublicFormPage` and `FormPreviewPage`, but the two have access to **different** inputs:

- `PublicFormPage` loads a `PublicForm`, which carries `branding.primaryColor` (verified in `apps/web/src/types/index.ts`). It resolves the full precedence chain `theme.accentColor ?? branding.primaryColor ?? DEFAULT_ACCENT`.
- `FormPreviewPage` loads an authenticated `FormRecord`, which carries **no** `branding`/`primaryColor` (verified: `FormRecord` in `types/index.ts` has no branding object; only `PublicForm` does). The preview therefore **cannot** resolve the workspace primaryColor; it resolves `theme.accentColor` only (and uses `DEFAULT_ACCENT` as the concrete literal for its own scaled submit button, since the preview container is custom and has no `.submit-button` CSS default to inherit).

**Pinned decision:** accept this gap rather than widen the `FormRecord` payload. Consequence: for a form that sets **no** per-form accent on a workspace whose `primaryColor` is non-default, the editor's live preview shows the default blue (`DEFAULT_ACCENT`) while the live public form shows the workspace color. This is acceptable because (a) the preview's job is to show the effect of the **per-form theme** the owner is editing, not to reproduce workspace branding, and (b) the moment the owner sets a per-form accent (the common case for someone opening the Appearance tab) preview and public agree exactly. The in-editor preview panel notes this with a small caption: "Workspace brand color is applied on the live form." `resolveTheme(theme, primaryColor?)` already takes `primaryColor` as optional, so preview simply calls it without that argument.

```
effectiveAccent = theme.accentColor ?? branding.primaryColor ?? undefined  // see note
effectiveBackground = theme.backgroundColor ?? (unset — today's default background)
effectiveFont = theme.fontFamily ?? (unset — today's default font stack)
coverImage: shown only if theme.coverImageUrl is set
```

**`accent` when nothing is set (review Finding 3 — pinned).** `resolveTheme` returns `accent: undefined` when **both** `theme.accentColor` and `branding.primaryColor` are absent — it does **not** substitute `DEFAULT_ACCENT`. Reason: the submit/next buttons get an inline `background` only when a color resolves; with `accent: undefined` they fall through to the `.submit-button` **CSS class** (verified: `App.css` `.submit-button { background: #2563eb }`), so an un-themed form on a default-branding workspace keeps **today's exact pixels**. This matches the "non-set fields pass `undefined`" rule stated below. `DEFAULT_ACCENT = "#2563eb"` is still exported from `apps/web/src/lib/theme.ts` as the single source of truth for the places that need a concrete literal (e.g. the Appearance-tab color-picker's initial swatch and the live-preview submit button, which has no CSS `.submit-button` default to fall back to in a scaled custom container); it is confirmed equal to the current `.submit-button` CSS background and to the eyebrow/progress-fill blue, so using it there reproduces today's look. The resolver itself returns `accent: undefined` rather than the literal so the public form never changes a pixel for un-themed forms.

Extract into `apps/web/src/lib/theme.ts` a `resolveTheme(theme, primaryColor?)` helper returning `{ accent, background, fontFamily, coverImageUrl }` (all optionally `undefined`) so public + preview share one resolver.

Threading the accent: today `PublicFormPage` inlines `form.branding?.primaryColor` on the submit/next buttons and eyebrow (verified: lines ~343, ~430, ~439 spread `...(form.branding?.primaryColor ? { background/color } : {})`). Replace those reads with `resolved.accent`, keeping the same conditional-spread shape so an `undefined` accent emits **no** inline style (preserving the CSS default). Apply `background` to the `.public-form-shell` (or `-wrap`) inline style only when set; apply `fontFamily` to the same container's `style={{ fontFamily }}` only when set; render the cover image as a banner `<img>` at the top of `.public-form-wrap` above the header only when set. Non-set fields pass `undefined`, leaving today's CSS defaults untouched.

### 1.6 Font loading mechanism + allow-list

**Mechanism:** inject a Google Fonts `<link rel="stylesheet">` into `document.head` at runtime **only when** a form resolves a non-default `fontFamily`, then set the container's `font-family`. A small `ensureFontLoaded(family)` util in `apps/web/src/lib/theme.ts`:

- Maps the family to its Google Fonts CSS2 href, e.g. `https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&display=swap`.
- Guards against duplicate injection via a `data-qivo-font="<family>"` attribute check.
- Is a no-op when `family` is undefined (default forms never hit the network).

Chosen over `@font-face`/self-hosting because: (a) zero build/asset changes, (b) Google's CDN handles the woff2 subsets, (c) matches the "load only when used" requirement cleanly, and (d) the allow-list is closed so the href is never attacker-controlled. The only external input into the href is `fontFamily`, which the server-side `z.enum` guarantees is one of the eight known families — no arbitrary-URL risk.

**Curated allow-list (8 families):** Inter, Roboto, Poppins, Montserrat, Open Sans, Lora, Playfair Display, Source Sans 3. (This same eight-name set is the authoritative API `z.enum`, the web mirror, and the two guard tests' expected set — see §1.11.) Mix of workspace-default-adjacent sans (Inter/Roboto/Open Sans/Source Sans 3), geometric display sans (Poppins/Montserrat), and two serifs (Lora/Playfair Display) for editorial forms. `Source Sans 3` is the current Google Fonts name for the former "Source Sans Pro"; the allow-list value and the CSS2 `family=Source+Sans+3` href must match.

Each family is stored with an explicit CSS fallback stack in the web helper, e.g. `"Playfair Display", Georgia, serif`, so a blocked CDN still renders a sensible fallback.

### 1.7 Editor UI — Appearance tab

Add a fourth tab to the existing `EditorTab` union in `FormEditorPage.tsx`:

```ts
type EditorTab = "builder" | "responses" | "settings" | "appearance";
```

Add an **Appearance** tab button beside Settings and an `activeTab === "appearance"` panel. New local state loaded from `schema.settings.theme` on form load:

```ts
const [coverImageUrl, setCoverImageUrl] = useState("");
const [accentColor, setAccentColor] = useState("");       // "" = inherit
const [backgroundColor, setBackgroundColor] = useState("");
const [fontFamily, setFontFamily] = useState("");         // "" = default
```

Controls:
- **Cover image** — Cloudinary upload (primary) **plus** a URL paste field (fallback). The upload reuses the exact public upload-signature → direct-Cloudinary flow already implemented in `PublicFormPage.uploadFileToCloudinary`. Extract that flow into `apps/web/src/lib/upload.ts` as `uploadToCloudinary(slug, file, onProgress?)` and call it from both the public file question and the editor cover control. The editor knows the form slug (`form.slug`) and its status (`form.status`). **DRAFT-form handling (pinned):** `getUploadSignatureForForm` is gated on `status: "PUBLISHED"` and throws `PUBLIC_FORM_NOT_FOUND` (404) for a DRAFT form — the **same** 404 a genuinely missing form returns. The editor must NOT infer "this is a draft, paste a URL instead" from that ambiguous 404. Instead, **gate the upload button on `form.status === "PUBLISHED"`** (already in state): when the form is not published, the upload control is disabled and a note is shown proactively — "Publish the form to upload a cover image, or paste an image URL below." The URL-paste field stays available in both states, so a draft can still get a cover via paste. A "Remove cover" button clears `coverImageUrl`. (If the signature request still fails at runtime on a published form — e.g. Cloudinary unconfigured — that is handled by the upload error path in §1.9, which surfaces an inline error and leaves the paste field available.)
- **Accent color** — `<input type="color">` plus a "Reset to workspace color" button that clears to `""`.
- **Background** — `<input type="color">` plus a "Reset" button (clears to `""` = default).
- **Font** — `<select>` populated from `FONT_ALLOW_LIST` with a "Default" option (value `""`).
- **Live preview** — a scaled-down panel mirroring the public form header: cover banner, workspace/eyebrow in the accent color, title, a sample question, and a submit button in the accent color, all inside a container with the chosen background + font. It reuses `resolveTheme` + `ensureFontLoaded` so it looks identical to the real public form.

**Save:** fold the theme into the **existing** settings PATCH (`saveFormSettings` → `PATCH /api/forms/:formId/settings`). Build the `theme` payload by including only set (non-empty) fields:

```ts
const theme: Record<string, string> = {};
if (coverImageUrl) theme.coverImageUrl = coverImageUrl;
if (accentColor) theme.accentColor = accentColor;
if (backgroundColor) theme.backgroundColor = backgroundColor;
if (fontFamily) theme.fontFamily = fontFamily;
// send theme object (possibly empty → clears all theming)
body.theme = theme;
```

Because the server does whole-object replace on `theme`, an empty object clears all theming back to inherit/default. No new endpoint is required for Feature 1.

### 1.8 Web types

Extend `apps/web/src/types/index.ts`:
- `FormSchema.settings.theme?: FormTheme` (and `responseEditing?`, `responseEditMinutes?` for Feature 2).
- Export a `FormTheme` type matching the API shape.

### 1.9 Error handling (Feature 1)

- **Settings PATCH with bad color/font/url** → Zod throws, the shared error middleware returns 400 `VALIDATION_ERROR`. Recoverable; the editor surfaces the message in its existing `setError` channel. Not logged server-side (expected client error).
- **Cover upload fails** (Cloudinary down, unconfigured, or DRAFT form with no signature) → the upload helper rejects; the editor catches and shows an inline error, leaving the URL-paste fallback available. Recoverable; logged client-side only via the existing upload catch.
- **Blocked font CDN** → font silently falls back to the per-family CSS stack; no error surfaced. Acceptable degradation.
- **Malformed stored theme** (e.g. hand-edited DB) → `resolveTheme` treats any missing/invalid field as "inherit"; never throws.

### 1.10 Testability (Feature 1)

- **Unit (API, Vitest per §0):** `updateFormSettingsSchema` accepts valid themes, rejects bad hex, non-allow-list fonts, non-URL covers, and unknown keys (`z.strictObject`) — a pure-function parse test, no DB. `FONT_ALLOW_LIST` is exported from `form.schemas.ts` for assertion.
- **Unit (web, Vitest — already present):** `resolveTheme` fallback precedence (theme → primaryColor → default, and preview-mode theme → default when `primaryColor` omitted); `ensureFontLoaded` injects once and no-ops on undefined. **Font allow-list drift guard (review Finding 5):** a web test asserts `FONT_ALLOW_LIST` (web mirror in `src/lib/theme.ts`) deep-equals a hardcoded expected array of the eight family names, so adding/removing a web font without updating the expected set fails the suite. See §1.11 for the full sync strategy.
- **Manual integration checklist (no automated DB harness — see §0):** PATCH settings → GET public form shows the theme; a form with no theme produces a payload with no `theme` key; `getFormSchema` round-trips a theme and omits it when absent; `getPublicForm` includes `theme` and still includes `branding`. (These exercise the DB and are verified by hand/HTTP, not Vitest.)

### 1.11 FONT_ALLOW_LIST duplication + sync guard (pinned)

`FONT_ALLOW_LIST` must exist in **two** places with no build-time shared module between the packages (confirmed: there is no shared package between `apps/api` and `apps/web`; the `FormSchema` types are already hand-duplicated across the two, so this matches the established pattern):

- **`apps/api/src/modules/forms/form.schemas.ts`** — the authoritative list, consumed by `z.enum(FONT_ALLOW_LIST)`. This is the security boundary: only a value in this enum can reach a stored `fontFamily`.
- **`apps/web/src/lib/theme.ts`** — a mirror driving the dropdown options + the Google Fonts href/fallback map.

**Decision:** keep the duplication (introducing a shared package for one constant is disproportionate and would break the existing duplication pattern), but add two guards so drift is caught:

1. **Cross-reference comments** on *both* arrays, each naming the other file's path and stating "keep in sync — the API enum is authoritative; a font present here but not there will be rejected with a 400, a font there but not here is never selectable."
2. **A web Vitest** (web already has Vitest) asserting the web `FONT_ALLOW_LIST` deep-equals a hardcoded expected array of the eight family names. Adding or reordering a web font without updating the expected set fails the test, forcing a conscious update. (The test lives on the web side because that is where a runner already exists; the API side gets the §1.10 schema test that references the same eight names, so an API-only change is also caught by a failing schema expectation.)

Both arrays use the **identical** family strings (e.g. `"Source Sans 3"`, not `"Source Sans Pro"`) so a value that passes `z.enum` maps to a valid href on the web side.

---

## Feature 2 — Same-session secure response editing

### 2.1 Settings (no migration)

Two new fields in `schema.settings`:

```ts
responseEditing?: "disabled" | "timed" | "until_close"; // default "disabled"
responseEditMinutes?: number;                            // default 15, only used when "timed"
```

**Enum is pinned** to exactly `"disabled" | "timed" | "until_close"`. `getFormSchema` defaults `responseEditing` to `"disabled"` (editing off by default, per requirement) and `responseEditMinutes` to `15`:

```ts
responseEditing: candidate?.settings?.responseEditing ?? "disabled",
responseEditMinutes: candidate?.settings?.responseEditMinutes ?? 15,
```

Unlike `theme`, these get a concrete default so downstream code never branches on `undefined`. Old forms become `"disabled"` — no behavior change.

Zod additions to `updateFormSettingsSchema`:

```ts
responseEditing: z.enum(["disabled", "timed", "until_close"]).optional(),
responseEditMinutes: z.coerce.number().int().min(1).max(1440).optional(), // 1 min – 24h
```

Merge in `updateFormSettings` via per-field conditional spread (same pattern as the other scalars). These are owner settings — they live in the editor Settings tab, not Appearance.

### 2.2 Public payload

`responseEditing` and `responseEditMinutes` are **respondent-relevant** (they drive the "Edit my response" affordance and client-side window timing), so they ride through `publicSettings` in `getPublicForm` — not added to the omit-list.

### 2.3 Edit-token model — stateless HMAC (chosen)

**Decision: stateless HMAC-signed token, NOT a `FormResponse` column + migration.**

Justification:
- **No migration** — satisfies the batch's hard constraint. A column (e.g. `editTokenHash`, `editExpiresAt`) would require a Prisma migration and a `DIRECT_URL` migration run on Railway.
- The token is **short-lived** and **scoped to one responseId**; there is no need to persist or revoke it server-side within a single session. Expiry is encoded in the token and re-validated against the live form state, so a leaked/replayed token still cannot bypass the server's window check.
- Signing uses `node:crypto`'s `createHmac("sha256", RESPONSE_EDIT_SECRET)` — the same `node:crypto` module already imported by `cloudinary.ts` (which uses `createHash` for its SHA-1 upload signature), so no new dependency. The implementer imports `createHmac` (and `timingSafeEqual`) from `node:crypto`, **not** `createHash`.

**Signing secret (pinned):** add `RESPONSE_EDIT_SECRET` to `apps/api/src/config/env.ts`:

```ts
RESPONSE_EDIT_SECRET: optional(
  "RESPONSE_EDIT_SECRET",
  "dev-insecure-response-edit-secret-change-me",
),
```

No existing env secret is suitable: there is no `SESSION_SECRET`/`JWT_SECRET` (sessions are opaque tokens, not signed), and `CLOUDINARY_API_SECRET` is optional (uploads degrade gracefully when unset) and semantically unrelated — reusing it would couple editing to Cloudinary config. A dedicated optional var with a loud dev fallback keeps local dev zero-config while letting production set a real secret. Document it in `.env.example` under the API section:

```
# Secret used to HMAC-sign same-session response-edit tokens. Optional:
# falls back to an insecure dev default if unset. SET A RANDOM VALUE IN PRODUCTION.
RESPONSE_EDIT_SECRET=
```

Add a startup guard: when `NODE_ENV === "production"` and `RESPONSE_EDIT_SECRET` is unset, log a warning (not a throw — editing is opt-in per form, and we don't want to crash the server for a feature most forms won't use). Log level: `console.warn` at boot, consistent with the codebase's `console`-based logging.

**Token format** (compact, URL-safe, self-describing):

```
token = base64url(payloadJson) + "." + base64url(hmacSha256(payloadJson, SECRET))
payloadJson = JSON.stringify({ rid: <responseId>, exp: <unixSeconds> })
```

- `rid` — the exact `FormResponse.id` the token authorizes. Binds the token to one response.
- `exp` — absolute expiry (unix seconds), derived from the mode at submit time (see 2.4).

A new `apps/api/src/services/responseEditToken.ts` exports:
- `signEditToken(responseId: string, expiresAt: Date): string`
- `verifyEditToken(token: string): { responseId: string; exp: number } | null` — returns `null` on any malformed input, bad signature (constant-time `crypto.timingSafeEqual`), or JSON parse failure. Expiry is **not** checked here (the caller re-checks against live form state so the authoritative window is always the server's current view).

### 2.4 Token issuance (extend `submitFormResponse`)

After a response is successfully created, compute the edit expiry from the mode and return a token alongside the response. `disabled` → no token.

```
mode = schema.settings.responseEditing            // default "disabled"
if mode === "disabled":            editToken = null
if mode === "timed":               exp = now + (responseEditMinutes ?? 15) * 60
if mode === "until_close":
    if scheduledCloseAt present:   exp = min(scheduledCloseAt, now + UNTIL_CLOSE_CAP)
    else:                          exp = now + UNTIL_CLOSE_CAP
```

**`until_close` with no `scheduledCloseAt` (pinned):** cap at **`UNTIL_CLOSE_CAP = 24h`**. Rationale: a form with no close date is effectively open-ended; an unbounded edit token would let a respondent mutate their response indefinitely from a single session, which is both a surprise and a mild abuse vector. 24h covers the realistic "same session / same day" intent while bounding token lifetime. When `scheduledCloseAt` **is** set, take the **earlier** of the close time and now+24h so editing never outlives the form accepting responses. The authoritative close re-check (2.5) also runs server-side, so even within an unexpired token, a form that has CLOSED rejects the edit.

`submitFormResponse` returns `{ ...response, quizScore, editToken }` where `editToken` is `string | null`. The public submit route includes it in the response body:

```ts
data: {
  response: { id, submittedAt },
  ...(response.quizScore ? { quizScore } : {}),
  ...(response.editToken ? { editToken: response.editToken } : {}),
}
```

### 2.5 Edit endpoint

**New public route:** `POST /api/forms/public/:slug/responses/:responseId/edit`.

CSRF: the existing `csrfProtection` middleware **exempts any path containing `/public/`** (verified in `csrf.ts`: `if (req.path.includes("/public/")) { next(); return; }`). This endpoint is under `/public/`, so it is CSRF-exempt by the **same** mechanism as the submit route — no change to `csrf.ts` needed. This answers design decision (6): confirmed, the exemption matches the submit route exactly.

Request body reuses `submitResponseSchema` plus an `editToken`:

```ts
export const editResponseSchema = submitResponseSchema.extend({
  editToken: z.string().min(1).max(2000),
});
```

**Token is read from the request body only.** The `editToken` is parsed from the JSON body via `editResponseSchema` and is never accepted from a query string or a request header. This keeps the token out of access logs, proxy logs, and the `Referer` header. The controller must pass `req.body.editToken` (post-validation) to the service; it must not fall back to `req.query` or `req.headers`.

New service function `editFormResponse(slug, responseId, input, editToken)`:

1. **Verify token** (`verifyEditToken`). `null` → throw `INVALID_EDIT_TOKEN` (403).
2. **Match response id** — token `rid` must equal the `:responseId` path param. Mismatch → `INVALID_EDIT_TOKEN` (403). This is the core anti-tampering guard: a client cannot present a token for response A to edit response B.
3. **Load the form — do NOT reuse the submit lookup.** The submit lookup (`submitFormResponse`) hard-filters `status: "PUBLISHED"` (verified: form.service.ts line ~1619). Reusing it would 404 a CLOSED form at this step and make the step-5 `until_close` CLOSED branch unreachable — the respondent would see "Form not available" instead of "Your edit window has closed." The edit path therefore uses a **dedicated, decoupled lookup** that accepts PUBLISHED **or** CLOSED:

   ```ts
   const form = await prisma.form.findFirst({
     where: { slug, deletedAt: null, status: { in: ["PUBLISHED", "CLOSED"] } },
     // include schema/scheduledCloseAt/status as submitFormResponse does
   });
   if (!form) throw PUBLIC_FORM_NOT_FOUND; // 404
   ```

   A DRAFT/ARCHIVED/deleted form yields no row → `PUBLIC_FORM_NOT_FOUND` (404). Note that `closeDueForms()` flips scheduled-close forms to `status: "CLOSED"` on a timer, so "status is CLOSED" and "`scheduledCloseAt` has passed" are two independent ways a form becomes closed — both are handled in step 5.
4. **Load the response** (`id === responseId AND formId === form.id`). Not found → `RESPONSE_NOT_FOUND` (404). The `formId` scope stops a token from editing a response that belongs to a different form sharing a guessed id.
5. **Re-check mode + window server-side** (authoritative, independent of the token's `exp`):
   - `responseEditing === "disabled"` → `EDITING_DISABLED` (403). (Owner may have turned editing off after the token was issued.)
   - `timed` → reject if `now > response.submittedAt + responseEditMinutes*60000` → `EDIT_WINDOW_EXPIRED` (403).
   - `until_close` → reject if the form is CLOSED (`form.status === "CLOSED"`) **or** `scheduledCloseAt` is set and has passed. **Both conditions throw `EDIT_WINDOW_EXPIRED` (403)** — the edit path NEVER throws `FORM_CLOSED`. (`FORM_CLOSED` is the submit-path semantic and is mapped to **410** in `app.ts`; the §2.8 table is the single source of truth and lists only `EDIT_WINDOW_EXPIRED` (403) for this condition. Reusing the 410 here would mis-signal the client, which maps 403/`EDIT_WINDOW_EXPIRED` to "Your edit window has closed.")
   - Also enforce the token `exp` as an upper bound: `now > token.exp` → `EDIT_WINDOW_EXPIRED` (403). (Belt-and-suspenders: the token cap and the live recompute should agree, but the live recompute wins.)
6. **Re-run the SAME answer validation as submit** against the new `answers`. Extract the shared validation from `submitFormResponse` into a private helper `validateSubmission(schema, answers)` so submit and edit run byte-identical **answer** rules (no drift). Any failure → `INVALID_RESPONSE` (400).

   **Pinned helper boundary (review Finding 1).** `validateSubmission(schema, answers)` contains **only** these three gates, in order (verified against the current `submitFormResponse` body at form.service.ts ~lines 1707–1752):
   - **unknown-question-id rejection** (every key in `answers` must map to a question in `schema`),
   - the **visibility-aware required-question check** — iterate `questions`, skip non-required and non-visible (`isQuestionVisible`) questions, and for `MULTI_ENTRY` apply the existing array special-case (missing if not an array or every element is `""`/`null`/`undefined`); throw `INVALID_RESPONSE` on the first missing one,
   - the **per-answer `validateAnswerAgainstQuestion` loop** over provided (non-empty) answers; throw `INVALID_RESPONSE` on the first problem.

   It does **NOT** contain the `EMAIL_REQUIRED` check or any duplicate / `respondentEmail` logic (verified: those live at form.service.ts ~lines 1753–1789 and on the create). The helper signature takes **no `email` argument** (email is not used inside it). The **submit** path keeps its existing `EMAIL_REQUIRED` and `DUPLICATE_RESPONSE` gates wrapped *around* the shared helper exactly as today. The **edit** path calls `validateSubmission(schema, answers)` only and runs **no** email-required check and **no** duplicate check — identity and email are fixed at first submit (see "Duplicate/`respondentEmail` handling on edit" below), so re-firing either would be wrong (an editor who cleared the email field would 400 on a gate that shouldn't apply, and a dedupe check would falsely collide the row with itself).
7. **Overwrite** the existing response's `answers`, and stamp `metadata.editedAt`:

```ts
const mergedMetadata = {
  ...(existing.metadata as Record<string, unknown> ?? {}),
  editedAt: new Date().toISOString(),
};
const updated = await prisma.formResponse.update({
  where: { id: responseId },
  data: {
    answers: input.answers as Prisma.InputJsonValue,
    metadata: mergedMetadata as Prisma.InputJsonValue,
  },
  select: { id: true, submittedAt: true }, // submittedAt is NOT written, so this is the original
});
```

**Return shape (review Finding 5 — pinned).** `editFormResponse` returns `{ id, submittedAt, quizScore }` where:
- `id` and `submittedAt` come from the `update` above. `submittedAt` is the row's **original** value — the `update` never writes it, so it is unchanged (an edit is a correction, not a new submission). The client keeps showing the original submit time.
- `quizScore` is **recomputed from the edited `answers`** using the **same** quiz-scoring logic as `submitFormResponse` (verified: the `if (schema.settings.quizMode) { ... isAnswerCorrect ... }` block at form.service.ts ~lines 1892–1910). Extract that block into a shared helper `computeQuizScore(schema, answers): { earned; total; percentage } | null` (returns `null` when `quizMode` is off) and call it from **both** `submitFormResponse` and `editFormResponse`, so a corrected quiz answer yields a correct on-screen score. No emails are sent on edit (see "Email/notifications on edit" below); the recomputed score is display-only in the edit response body.

**Design decision (5) — `editedAt` in metadata JSON (chosen) vs a column.** Store `editedAt` in the existing `metadata` JSON. No migration; the response dashboard already renders `metadata` as a JSON block, so the edit timestamp is visible for free; and it matches how `email`/`source` already live in metadata. A dedicated column would add a migration for a display-only marker — not worth it.

**Email/notifications on edit:** do **not** re-fire owner notification, confirmation, or digest emails on edit, and do **not** re-run quiz scoring persistence changes beyond what's stored. Rationale: those are "new response" events; an edit is a correction, and re-notifying would spam the owner. (If the form is a quiz, recompute and return `quizScore` in the edit response so the respondent still sees an updated score on screen, but emit no emails.) Analytics: do not record a new `submission` event on edit (it would inflate conversion). This keeps edit side-effect-free except for the overwrite.

**Duplicate/`respondentEmail` handling on edit:** the edit does **not** change `respondentEmail` or `respondentId` — identity is fixed at first submit. The email is not re-collected for dedupe on edit (the same person is editing their own row). Keep `respondentEmail` as-is.

### 2.6 Response endpoint body

The submit route already returns `{ response: { id, submittedAt } }`. Add `editToken` when present (2.4). The edit route returns the same shape — `response.id` and the **original** `response.submittedAt` (unchanged by the edit, per §2.5 step 7) — plus the **recomputed** `quizScore` when applicable:

```ts
// editFormResponse returns { id, submittedAt (original), quizScore (recomputed | null) }
res.json({ success: true, data: { response: { id, submittedAt }, ...(quizScore ? { quizScore } : {}) } });
```

The edit route does **not** return a new `editToken`: the client reuses the same-session token it already holds (§2.7), and re-issuing would not extend the authoritative server-side window anyway.

### 2.7 Frontend — `PublicFormPage`

New same-session state (never persisted — lost on reload, which is intended):

```ts
const [responseId, setResponseId] = useState<string | null>(null);
const [editToken, setEditToken] = useState<string | null>(null);
const [editWindowExpiresAt, setEditWindowExpiresAt] = useState<number | null>(null);
const [isEditing, setIsEditing] = useState(false);
```

On successful submit, capture `response.id` + `editToken` from the response body, and compute the client-side window end for the UI countdown:
- `timed` → `submittedAt + responseEditMinutes*60000`.
- `until_close` → `scheduledCloseAt` if set, else null (button stays available until the server rejects).

**Confirmation screen:** when `editToken` is present and the window has not client-side-expired, show an **"Edit my response"** button and a note: *"You can edit your response until &lt;time&gt;."* Clicking sets `isEditing = true`, clears `submitted`, and re-renders the form **prefilled from the `answers` state still held in memory** (answers are never cleared on submit, so they are already correct). The email field likewise retains its value.

**Resubmit while editing:** `handleSubmit` branches — if `isEditing && responseId && editToken`, call the edit endpoint instead of the submit endpoint:

```ts
await publicPost(`/api/forms/public/${slug}/responses/${responseId}/edit`, {
  answers,
  ...(collectEmail ? { email } : {}),
  metadata: { source: "qivo-web" },
  editToken,
});
```

On success, return to the confirmation screen (`setSubmitted(true)`, `setIsEditing(false)`), keeping the same `responseId`/`editToken` so the respondent can edit again until the window closes. The server is the final authority: if the window expired between render and click, the edit endpoint returns `EDIT_WINDOW_EXPIRED` and the UI shows the message and hides the edit button.

**Client-side window expiry:** a `setInterval`/`setTimeout` compares `Date.now()` against `editWindowExpiresAt`; when passed, hide/disable the edit button. This is UX only — the server re-check in 2.5 is the real guard.

### 2.8 Error handling (Feature 2)

| Condition | HTTP | Error name | Recoverable? | Caller sees | Logged? |
|---|---|---|---|---|---|
| Malformed/forged/expired token signature | 403 | `INVALID_EDIT_TOKEN` | No (session over) | "This edit link is no longer valid." | No (expected) |
| Token `rid` ≠ path `responseId` | 403 | `INVALID_EDIT_TOKEN` | No | same | **Yes** — `console.warn` (tamper signal) |
| Form not found / not published | 404 | `PUBLIC_FORM_NOT_FOUND` | No | "Form not available." | No |
| Response not found / wrong form | 404 | `RESPONSE_NOT_FOUND` | No | "Response not found." | No |
| Editing disabled (owner changed it) | 403 | `EDITING_DISABLED` | No | "Editing is no longer allowed." | No |
| Window expired (timed/until_close/token exp) | 403 | `EDIT_WINDOW_EXPIRED` | No | "Your edit window has closed." | No |
| Invalid answers on re-validate | 400 | `INVALID_RESPONSE` | Yes (fix & resubmit) | the specific validation message | No |
| DB update failure | 500 | (generic) | Retry | "Unable to save your changes." | **Yes** — error middleware |

**Wiring into `app.ts` (critical — verified).** The API error handler is a `switch (error.name)` in `apps/api/src/app.ts` whose `default` branch returns **500 `INTERNAL_SERVER_ERROR`**. If the three new error names are thrown in the service but not given explicit `case`s in that switch, every edit rejection becomes a 500 and the frontend's error-message mapping (the "Caller sees" column above) never fires. Add exactly these three cases to the `app.ts` switch (all 403):

```ts
case "INVALID_EDIT_TOKEN":
  res.status(403).json({ success: false, error: { code: "INVALID_EDIT_TOKEN", message: error.message } });
  return;
case "EDITING_DISABLED":
  res.status(403).json({ success: false, error: { code: "EDITING_DISABLED", message: error.message } });
  return;
case "EDIT_WINDOW_EXPIRED":
  res.status(403).json({ success: false, error: { code: "EDIT_WINDOW_EXPIRED", message: error.message } });
  return;
```

The edit path **reuses** error names that already have cases in the switch (verified in `app.ts`): `PUBLIC_FORM_NOT_FOUND` (404), `RESPONSE_NOT_FOUND` (404), and `INVALID_RESPONSE` (400) are all already mapped — no change needed for those. `FORM_CLOSED` (410) is also mapped but is deliberately **not** used on the edit path (see §2.5 step 5).

### 2.9 Invariants & ownership

- **"A client can only overwrite its own just-submitted response"** — enforced by the **token signature + `rid`-matches-path** check in the service layer (step 1–2). The route/controller does not enforce it; the service is the single owner so both the (future) authed path and the public path share one guard.
- **"Editing window"** — enforced in the **service layer** against live form state (step 5), not trusted from the client or even solely from the token. The token `exp` is a secondary cap.
- **"Editing off by default"** — enforced by `getFormSchema` default `"disabled"`, so a form that never opted in issues no token and rejects edits.

### 2.10 Testability (Feature 2)

- **Unit (API, Vitest per §0) — the security core, MUST be automated:** `signEditToken`/`verifyEditToken` round-trip; `verifyEditToken` returns `null` for a tampered payload, a bad signature, garbage input, a truncated token, and a token missing the `.` separator; constant-time `crypto.timingSafeEqual` is used for the signature compare. Expiry derivation math for all three modes including the `until_close` 24h cap and the `min(scheduledCloseAt, now+cap)`. These are **pure functions** (no DB), so they run under Vitest with an injected known `RESPONSE_EDIT_SECRET` via `process.env`. The HMAC is deterministic given a fixed secret, making the assertions stable.
- **Unit (API, Vitest):** the extracted `validateSubmission(schema, answers)` helper (its pinned three-gate boundary per §2.5 step 6 — unknown-question rejection, visibility-aware required check, per-answer validation; **no** email-required and **no** duplicate logic) throws `INVALID_RESPONSE` for an unknown question id, a missing required (incl. `MULTI_ENTRY` empty-array) answer, and a type-mismatched answer, and passes a valid payload — pure function, no DB. The same helper is the single call made by both submit and edit, so answer-rule parity is structural, not just asserted.
- **Manual integration checklist (no automated DB harness — see §0 and §2.11):** submit → receive token → edit overwrites answers and sets `metadata.editedAt`; editing a mismatched `responseId` with a valid token is rejected (403 `INVALID_EDIT_TOKEN`); editing after the window with a fake/elapsed clock is rejected (403 `EDIT_WINDOW_EXPIRED`); editing a `disabled` form is rejected (403 `EDITING_DISABLED`); editing a CLOSED `until_close` form is rejected (403 `EDIT_WINDOW_EXPIRED`, not 410); edits emit no owner/confirmation/digest emails and record no `submission` analytics event.

### 2.11 Manual integration verification checklist

Because §0 descopes the DB/HTTP integration tests from automation, the implementer runs this checklist by hand (dev server + a published test form) before marking Feature 2 done:

1. **Happy path (timed):** set `responseEditing: "timed"`, `responseEditMinutes: 15`; submit a response; confirm the response body carries `editToken`; click "Edit my response"; change an answer; resubmit; confirm the DB row's `answers` changed and `metadata.editedAt` is set and visible in the Response dashboard's metadata JSON block (verified: `ResponseDashboardPage` dumps full `metadata` as a `<pre>` block — the timestamp shows for free).
2. **responseId binding:** capture a valid token for response A; POST it to the edit endpoint with a different `:responseId` (B) → 403 `INVALID_EDIT_TOKEN`; confirm a `console.warn` tamper log fired.
3. **Forged/tampered token:** flip a character in the signature segment → 403 `INVALID_EDIT_TOKEN`.
4. **Window expiry (timed):** set `responseEditMinutes: 1`; submit; wait > 1 min; attempt edit → 403 `EDIT_WINDOW_EXPIRED`; confirm the frontend hid the edit button client-side at the same boundary.
5. **until_close on a CLOSED form:** set `until_close`; manually set the form to CLOSED (or let `scheduledCloseAt` elapse / `closeDueForms` run); attempt edit → 403 `EDIT_WINDOW_EXPIRED` (NOT 410 `FORM_CLOSED`), and the lookup still resolves the form (proving the decoupled PUBLISHED-or-CLOSED lookup from §2.5 step 3).
6. **Owner disabled after issue:** submit with editing on; owner flips to `disabled`; attempt edit → 403 `EDITING_DISABLED`.
7. **No side-effects:** after an edit, confirm no new owner-notification/confirmation email was sent and no new `submission` event row was created.

---

## Feature 3 — Array answers as chips (display only)

### 3.1 Scope

Render **array-valued answers** (any answer stored as a JS array — e.g. `MULTI_ENTRY`, and `MULTIPLE_CHOICE` **when multiple options are selected and stored as a `string[]`**) as visual **chips** instead of comma-joined text, in:
- `ResponseDashboardPage.tsx` — the `ResponseDetail` modal's answer list (`renderAnswerValue`).
- `FormReportsPage.tsx` — the per-question text-report **samples** (`renderSampleAnswer`).

**Scope caveat (pinned, per review Finding 9):** chipping is strictly an `Array.isArray(value)` test. A single-selection `MULTIPLE_CHOICE` answer stored as a **plain string** (verified: `validateAnswerAgainstQuestion` accepts `selections = isArray ? value : [value]`, so single selections may be persisted as a scalar string) does **not** become a chip — it renders exactly as today (plain text). This is intentional: the feature is "array-valued answers render as chips," not "all multiple-choice answers render as chips." Promoting single-string selections into chips is explicitly **out of scope** for this batch.

**Explicitly unchanged:** `formatResponseValue` and both export paths (`downloadResponsesCsv`, `downloadResponsesExcel`) keep arrays comma-joined. Non-array values (strings, numbers, file URLs with thumbnail/link) render exactly as today.

### 3.2 Reusable chip renderer

Add a tiny presentational component `apps/web/src/components/Chips.tsx`:

```tsx
export function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span>—</span>; // defensive: empty array
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            padding: "2px 10px",
            borderRadius: 999,
            background: "#eef2ff",
            color: "#3730a3",
            fontSize: "0.8rem",
            fontWeight: 600,
            maxWidth: "100%",
            overflowWrap: "anywhere", // long entries wrap instead of overflow
          }}
        >
          {item}
        </span>
      ))}
    </span>
  );
}
```

Colors reuse the indigo accent family already present in the codebase (`#eef2ff`/`#3730a3`), consistent with existing chip-like UI. Keyed by index because entries may repeat and have no stable id.

### 3.3 Wiring

**ResponseDashboardPage — `renderAnswerValue`:** add an array branch **before** the string/URL handling:

```ts
function renderAnswerValue(value: unknown) {
  if (Array.isArray(value)) {
    const items = value.map((v) => String(v).trim()).filter(Boolean);
    return <Chips items={items} />;
  }
  // ...existing http-URL thumbnail/link branch...
  // ...existing formatResponseValue fallback...
}
```

File-upload answers are single strings (not arrays), so the existing thumbnail/link branch is untouched. `formatResponseValue` itself is **not** modified (exports still call it and must stay comma-joined).

**FormReportsPage — samples:** the API already flattens `MULTI_ENTRY` into one entry per `sample[]` element and `MULTIPLE_CHOICE` is a `choice` report (bar chart, no text samples), so each `sample` entry is already a single scalar string. Chips here means rendering each sample entry as an individual chip rather than a plain row. Update the `sample.map(...)` block so each non-URL sample renders as a `<Chips items={[answer]} />` (or keep URL/file handling via the existing `renderSampleAnswer`, wrapping only the plain-text case in a chip). Net effect: text samples (including each MULTI_ENTRY entry) appear as chips; file samples keep their thumbnail/link.

Edge: a sample that is itself a comma-joined legacy value (older data) is shown as one chip — acceptable, since the API now emits one entry per element for new data.

### 3.4 Error handling / defensiveness (Feature 3)

Display-only; no network or validation. Defensive cases: empty array → `—`; non-string array members coerced via `String()`; blanks filtered; long entries wrap via `overflow-wrap: anywhere`. Nothing throws.

### 3.5 Testability (Feature 3)

- **Unit (component):** `Chips` renders N chips for N items, `—` for empty, wraps long text (style assertion), coerces non-strings.
- **Visual/integration:** a response with a `MULTIPLE_CHOICE` array shows chips in the detail modal; CSV/Excel export of the same response still contains the comma-joined cell (export functions unchanged — assert by unit-testing `formatResponseValue` stays comma-joined).

---

## Files touched (summary)

**API (`apps/api`):**
- `package.json` — add `vitest` dev dep; replace the stub `test` script with `vitest run` (+ optional `test:watch`). **(§0, prerequisite — do first.)**
- `vitest.config.ts` — **new**: Node env, `include: ["src/**/*.test.ts"]`.
- `src/services/responseEditToken.test.ts` — **new**: token sign/verify security unit tests (§2.10).
- `src/modules/forms/form.schemas.test.ts` — **new**: `updateFormSettingsSchema`/`FONT_ALLOW_LIST` unit tests (§1.10).
- `src/config/env.ts` — add optional `RESPONSE_EDIT_SECRET` + prod-warn.
- `src/app.ts` — add 3 error-name `case`s (`INVALID_EDIT_TOKEN`, `EDITING_DISABLED`, `EDIT_WINDOW_EXPIRED`), all 403 (§2.8).
- `src/modules/forms/form.service.ts` — `FormSchema` type (`theme`, `responseEditing`, `responseEditMinutes`); `getFormSchema` defaults; `updateFormSettings` merge; `getPublicForm` passes theme + editing settings through; extract `validateSubmission(schema, answers)` (answer-only gates, §2.5 step 6) and `computeQuizScore(schema, answers)` (§2.5 step 7), both shared by submit + edit; `submitFormResponse` returns `editToken`; new `editFormResponse` returning `{ id, submittedAt (original), quizScore }`.
- `src/modules/forms/form.schemas.ts` — `FONT_ALLOW_LIST`, `themeSchema`, editing fields in `updateFormSettingsSchema`; `editResponseSchema`.
- `src/modules/forms/form.routes.ts` — submit route returns `editToken`; new `POST /public/:slug/responses/:responseId/edit` (reads `editToken` from body only, §2.5).
- `src/services/responseEditToken.ts` — **new**: `signEditToken`/`verifyEditToken`.
- `.env.example` — document `RESPONSE_EDIT_SECRET`.

**Web (`apps/web`):**
- `src/types/index.ts` — `FormTheme`, `theme`, `responseEditing`, `responseEditMinutes` on `FormSchema.settings`.
- `src/lib/theme.ts` — **new**: `FONT_ALLOW_LIST` (mirror, cross-ref comment per §1.11), `DEFAULT_ACCENT`, `resolveTheme`, `ensureFontLoaded`, font href + fallback map.
- `src/lib/theme.test.ts` — **new**: `resolveTheme` precedence + preview fallback; `ensureFontLoaded` dedupe/no-op; `FONT_ALLOW_LIST` drift guard (§1.10/§1.11).
- `src/lib/upload.ts` — extract `uploadToCloudinary(slug, file, onProgress?)` reused by public file question + editor cover.
- `src/components/Chips.tsx` — **new** chip renderer.
- `src/pages/FormEditorPage.tsx` — Appearance tab + controls + live preview; editing-mode settings in Settings tab; fold theme + editing fields into the settings PATCH.
- `src/pages/PublicFormPage.tsx` — apply resolved theme (accent/background/font/cover); edit-token state + "Edit my response" flow calling the edit endpoint.
- `src/pages/FormPreviewPage.tsx` — apply resolved theme for parity with public.
- `src/pages/ResponseDashboardPage.tsx` — chips in `renderAnswerValue` (exports unchanged).
- `src/pages/FormReportsPage.tsx` — chips in text-report samples.

## Cross-cutting decisions recap

1. **Theme storage** — nested optional `theme` in `schema.settings`; absent = inherit; whole-object replace on PATCH; Zod hex + `z.enum` font + `z.strictObject`. No migration.
2. **Edit-token model** — stateless HMAC-SHA256 (`node:crypto`), payload `{rid, exp}`, signed with new optional `RESPONSE_EDIT_SECRET`; chosen over a column to avoid a migration and because single-session scope needs no persistence. Validation: signature (timing-safe) + `rid` must equal path responseId + live server-side mode/window recheck.
3. **Font loading** — runtime `<link>` injection on demand, deduped; closed 8-family allow-list; per-family CSS fallback stack.
4. **`until_close` with no `scheduledCloseAt`** — cap at 24h; when a close date exists, use the earlier of close-time and now+24h; server re-checks CLOSED status regardless.
5. **`editedAt` marker** — in `metadata` JSON, not a column. No migration; visible in the existing metadata block.
6. **CSRF exemption** — the edit endpoint is under `/public/`, which `csrfProtection` already exempts; same mechanism as the submit route. No change to `csrf.ts`.
7. **Edit-path form lookup** — a dedicated `status IN (PUBLISHED, CLOSED)` lookup, decoupled from the PUBLISHED-only submit lookup, so the `until_close` CLOSED branch is reachable and returns 403 `EDIT_WINDOW_EXPIRED` (never 410 `FORM_CLOSED`). The three new error names are wired into the `app.ts` switch as 403s.
8. **Test infrastructure** — add Vitest to `apps/api` as the first step (§0); security-critical token logic and Zod schemas get **automated** pure-function unit tests; DB/HTTP integration is a **manual checklist** (§2.11). Font allow-list drift is caught by a web Vitest + cross-ref comments (§1.11).
9. **Preview parity** — `FormPreviewPage` falls back to `DEFAULT_ACCENT` (no workspace color in `FormRecord`); accepted gap, not a payload change (§1.5).
10. **Chips scope** — only `Array.isArray` answers chip; single-string multiple-choice stays plain text; exports stay comma-joined (§3.1).

---

## Review responses — second revision iteration

This iteration addresses the current `design-review.md` (verdict `CHANGES_REQUESTED`: **1 MEDIUM, 0 HIGH, 4 NIT**). All five findings are resolved below; every code claim was re-verified against the live sources before editing.

- **Finding 1 (MEDIUM) — `validateSubmission` extraction boundary under-specified. ADDRESSED.** §2.5 step 6 now pins the helper as `validateSubmission(schema, answers)` (no `email` param) containing **only** three gates — unknown-question rejection, visibility-aware required check (incl. the `MULTI_ENTRY` empty-array special-case), and the per-answer `validateAnswerAgainstQuestion` loop — explicitly **excluding** `EMAIL_REQUIRED` and all duplicate/`respondentEmail` logic (verified against form.service.ts ~lines 1707–1789). Submit keeps its email-required and duplicate gates wrapped around the helper; edit runs neither (identity + email fixed at first submit). §2.10 updated to test the pinned boundary.
- **Finding 2 (NIT) — HMAC vs `createHash` imprecision. ADDRESSED.** §2.3 now states signing uses `createHmac("sha256", …)` from `node:crypto` — the same module `cloudinary.ts` imports (it uses `createHash` for SHA-1, verified) — and instructs the implementer to import `createHmac`/`timingSafeEqual`, not `createHash`.
- **Finding 3 (NIT) — `DEFAULT_ACCENT` vs submit-button default. ADDRESSED.** Verified `.submit-button { background: #2563eb }` in `App.css` (so the literal does equal today's button), **and** adopted the safer resolver behavior: §1.5 now has `resolveTheme` return `accent: undefined` when both `theme.accentColor` and `branding.primaryColor` are absent, so un-themed forms fall through to the CSS class and keep today's exact pixels. `DEFAULT_ACCENT` remains exported for the Appearance tab's picker swatch and the preview's custom submit button (which has no CSS default to inherit).
- **Finding 4 (NIT) — `.strict()` deprecated in Zod v4. ADDRESSED.** §1.2 now uses `z.strictObject({ … })` (both apps on `zod@^4.4.3`); §1.10 and the decisions recap updated to match.
- **Finding 5 (NIT) — edit response body shape not pinned. ADDRESSED.** §2.5 step 7 and §2.6 now pin that `editFormResponse` returns `{ id, submittedAt (original, never rewritten), quizScore (recomputed) }`, with the quiz-scoring block extracted into a shared `computeQuizScore(schema, answers)` helper (verified against the scoring block at form.service.ts ~lines 1892–1910) used by both submit and edit.

### Prior revision (resolved earlier, retained for history)

The first revision addressed the original `design-review.md` (verdict `CHANGES_REQUESTED`: 2 HIGH, 3 MEDIUM, 4 NIT). Every finding was resolved below; all code claims were re-verified against the sources before editing.

- **Finding 1 (HIGH) — edit-form lookup scoping vs the `until_close` CLOSED check. ADDRESSED.** §2.5 step 3 now pins a **dedicated** lookup `status: { in: ["PUBLISHED", "CLOSED"] }`, decoupled from the PUBLISHED-only submit lookup (verified: `submitFormResponse` filters `status: "PUBLISHED"` at form.service.ts ~line 1619). Step 5's CLOSED/elapsed branch is now reachable and throws `EDIT_WINDOW_EXPIRED` (403). Also recapped as decision #7.
- **Finding 2 (HIGH) — unexecutable API test plan. ADDRESSED.** New §0 adds Vitest to `apps/api` as the first implementation step (verified: `apps/api/package.json` test script is the `echo ... exit 1` stub; `apps/web` has `vitest@^3.2.4`). Security-critical token + schema tests are automated pure-function unit tests (no DB); DB/HTTP integration is descoped to a manual checklist (§2.11). §1.10/§2.10 rewritten to match.
- **Finding 3 (MEDIUM) — new error names must be wired into `app.ts` or they 500. ADDRESSED.** §2.8 now pins the exact three `case` blocks (all 403) and confirms (verified against `app.ts`) that `PUBLIC_FORM_NOT_FOUND` (404), `RESPONSE_NOT_FOUND` (404), and `INVALID_RESPONSE` (400) already have cases. `src/app.ts` added to Files touched.
- **Finding 4 (MEDIUM) — conflicting error names for the closed-form edit. ADDRESSED.** §2.5 step 5 now always throws `EDIT_WINDOW_EXPIRED` (403) for a CLOSED/elapsed form and never `FORM_CLOSED` (which is 410, verified); the `/ FORM_CLOSED` alternative is removed. §2.8 table remains the single source of truth.
- **Finding 5 (MEDIUM) — FONT_ALLOW_LIST duplication sync guard + API test runner. ADDRESSED.** Test-runner half folds into Finding 2 (§0). New §1.11 pins the sync strategy: keep the two-copy duplication (matches the existing hand-duplicated `FormSchema` pattern; no shared package exists — verified), add cross-reference comments on both arrays, and add a web Vitest asserting the web list deep-equals the eight expected names. Referenced from §1.2, §1.6, §1.10.
- **Finding 6 (NIT) — FormPreviewPage cannot resolve workspace `primaryColor`. ADDRESSED.** §1.5 reworded with the pinned decision (verified: `FormRecord` in `types/index.ts` has no `branding`; only `PublicForm` does): preview falls back to `theme.accentColor ?? DEFAULT_ACCENT`, accept the gap, show a caption, no payload change. Recapped as decision #9.
- **Finding 7 (NIT) — DRAFT cover upload infers 'not published' from a generic 404. ADDRESSED.** §1.7 now gates the upload button on `form.status === "PUBLISHED"` and shows the paste-URL note proactively, instead of inferring from the ambiguous `PUBLIC_FORM_NOT_FOUND` 404.
- **Finding 8 (NIT) — pin edit token to request body only. ADDRESSED.** §2.5 adds an explicit sentence: the token is read only from the request body, never a query string or header (keeps it out of logs/referrers).
- **Finding 9 (NIT) — single-select multiple-choice stored as a string won't chip. ADDRESSED.** §3.1 reworded to "array-valued answers"; the single-string multiple-choice case is explicitly documented as rendering plain text and declared out of scope. Recapped as decision #10.

One review "Unverified" note confirmed during this revision: `ResponseDashboardPage` **does** render the full `metadata` object as a `<pre>` JSON block (lines ~470–475), so `metadata.editedAt` is visible for free — the §2.5 claim holds. Captured in the §2.11 checklist item 1.
