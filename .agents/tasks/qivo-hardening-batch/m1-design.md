# M1 — Server-side file-type + host enforcement for FILE_UPLOAD and SIGNATURE (Design)

## Overview

Today `validateAnswerAgainstQuestion` (`apps/api/src/modules/forms/form.service.ts`,
the shared `case "SIGNATURE": case "FILE_UPLOAD":` branch, ~L1498–1503) accepts
**any** string matching `/^https?:\/\//`. A crafted submit that bypasses the UI
can therefore store an arbitrary off-type, oversize, or non-Cloudinary URL as the
answer. This design replaces that one branch with a concrete host + (where
determinable) type check. It is a hardening tweak, not a redesign: we touch only
the FILE_UPLOAD / SIGNATURE validation branch and add one small pure helper plus
unit tests. No route, schema, DB, or client change is required.

The authoritative facts below are all confirmed from the code, not assumed:

- **Upload path** (`apps/web/src/lib/upload.ts`): the browser POSTs to
  `https://api.cloudinary.com/v1_1/<cloudName>/<image|raw>/upload` and stores the
  returned `secure_url` as the answer. `secure_url` is a Cloudinary **delivery**
  URL, which is served from host `res.cloudinary.com`.
- **Folder** (`apps/api/src/services/cloudinary.ts` `signUpload`, called as
  `signUpload(\`qivo/forms/${form.id}\`)` in `form.service.ts`): every signed
  upload lands under `qivo/forms/<formId>/…`.
- **Resulting delivery URL shape**:
  `https://res.cloudinary.com/<cloudName>/<image|raw>/upload/v<version>/qivo/forms/<formId>/<name>.<ext>`
  (the `v<version>` segment and any transformation segments are optional; the
  extension is present because Cloudinary preserves the uploaded filename).
- **Resource type / extension behavior** (`uploadToCloudinary`): images go via
  `image` and, for FILE_UPLOAD, are recompressed in-browser to `.jpg` by
  `maybeCompressImage`; non-images (PDF/Office docs) go via `raw` keeping their
  original extension. SIGNATURE uploads via `skipCompression: true` producing a
  crisp `.png` from `SignaturePad.toPngFile()`.
- `question.settings` is typed `Record<string, unknown>` on the API side
  (`FormQuestion` in `form.service.ts`), so `allowedFileTypes` must be read
  defensively (it is a client-only setting — confirmed: `allowedFileTypes` /
  `maxFileSizeMB` appear nowhere in `apps/api`).

## Technology stack (locked)

No new dependencies. Plain TypeScript using the built-in `URL` parser (already
used in the `URL` case of the same function). Tests use the existing API
**Vitest** suite (`apps/api/src/modules/forms/form.service.test.ts`). Node's
`URL` is the single source of truth for host parsing — we never host-match with a
regex against the raw string (regex host checks are the classic bypass:
`https://res.cloudinary.com.evil.com/…` must be rejected, and only a real URL
parser's `.hostname` does that correctly).

## The allowed Cloudinary host (pinned)

Enforcement keys off the parsed `url.hostname`, compared case-insensitively
(`hostname` is already lowercased by the `URL` parser) against an exact set:

```
const CLOUDINARY_DELIVERY_HOSTS = new Set([
  "res.cloudinary.com",
]);
```

Rationale for a single host: every answer URL is a Cloudinary `secure_url`
delivery URL, and Cloudinary's default secure delivery host is
`res.cloudinary.com`. The cloud name is the **first path segment**
(`/<cloudName>/…`), not part of the host, so the host is fixed even though
`CLOUDINARY_CLOUD_NAME` is env-driven. We deliberately do **not** validate the
cloud-name path segment or the `qivo/forms/<formId>` folder segment: the signed
upload already constrains where bytes can land (the signature only authorizes the
form's folder), and matching the folder here would couple validation to the
exact delivery-URL layout (versioning / transformation segments) and risk false
rejections. Host + type is the right blast-radius for this fix; the folder
constraint is already owned by the signed-upload layer.

Edge rules for the host check, in order:

1. Value must be a string (existing guard) and must parse via `new URL(value)`.
   A parse failure → reject.
2. `url.protocol` must be exactly `"https:"`. Plain `http:` is rejected — all
   `secure_url`s are https, so http indicates a hand-crafted value.
3. `url.hostname` must be in `CLOUDINARY_DELIVERY_HOSTS`. Anything else
   (including `res.cloudinary.com.evil.com`, `evil.com`, userinfo tricks like
   `https://res.cloudinary.com@evil.com/…` which parse to hostname `evil.com`) →
   reject.

The host check applies to **both** FILE_UPLOAD and SIGNATURE, unconditionally
(even when `allowedFileTypes` is unset).

## Extension extraction (pinned)

Derive the extension from the URL **pathname** only (never the query/fragment):

```
const path = url.pathname;                 // "/demo/raw/upload/v1/qivo/forms/f1/report.pdf"
const lastSeg = path.split("/").pop() ?? ""; // "report.pdf"
const dot = lastSeg.lastIndexOf(".");
const ext = dot > 0 ? lastSeg.slice(dot + 1).toLowerCase() : "";  // "pdf" | ""
```

If `ext === ""` the extension is **unknown** (see fallback below). We key off the
pathname's last segment, not a regex over the whole URL, so query strings like
`?x=.pdf` can't spoof the type.

## FILE_UPLOAD type enforcement (pinned)

Read `allowedFileTypes` defensively:

```
const allowed = Array.isArray(question.settings?.allowedFileTypes)
  ? (question.settings!.allowedFileTypes as unknown[]).filter(
      (t): t is string => typeof t === "string",
    )
  : [];
```

- If `allowed.length === 0` → no type restriction; host check alone governs.
- If `allowed` is set → expand each allowed MIME to its permitted extension(s)
  via the pinned map below, union them into an allowed-extension set, then:
  - extension **known** and **in** the set → accept (host already checked).
  - extension **known** and **not** in the set → **reject** with
    `"file type not allowed"`.
  - extension **unknown** (empty) → **accept** (unknown-extension fallback, see
    below). The host check still applied.

### Pinned MIME → allowed-extension map

Covers exactly the allow-list vocabulary the builder can emit (`MIME_TO_EXT` /
`MIME_FRIENDLY` in `PublicFormPage.tsx`), plus the browser-compression reality
that FILE_UPLOAD images are re-encoded to `.jpg`:

```
const MIME_EXTENSIONS: Record<string, string[]> = {
  // image/* is a wildcard: any recognized image extension is allowed.
  "image/*": ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"],
  "application/pdf": ["pdf"],
  // Office — OpenXML
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  // Office — legacy binary
  "application/msword": ["doc"],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.ms-powerpoint": ["ppt"],
};
```

Notes pinned into the map:

- `image/*` is the only wildcard entry and its extension list is **identical** to
  `isImageUrl`'s `imageExts` in `apps/web/src/lib/upload.ts`, so server and client
  agree on what "an image" is. It includes `jpg` **and** `jpeg` so that the
  client's `maybeCompressImage` output (`.jpg`) and raw-camera `.jpeg` both pass.
- Any allowed MIME **not** present as a key in `MIME_EXTENSIONS` contributes no
  extensions (it is ignored for the allow-set). This cannot tighten security
  incorrectly: if the allow-list contained only unknown MIMEs the allow-set would
  be empty, so only the unknown-extension fallback could let a file through — and
  the host check still applies. In practice the builder only emits the keys
  above.

### Unknown-extension fallback (pinned)

If the extension cannot be determined (empty `ext`), **do not hard-fail**. Accept
the answer (host check having already passed). Rationale: Cloudinary delivery URLs
*normally* carry the extension, but transformation/format-conversion URLs or raw
assets stored without an extension can legitimately omit it; a hard fail here
would produce false rejections of genuine uploads. The security floor is the host
check, which always runs; the type check is best-effort tightening on top.

## SIGNATURE enforcement (pinned)

SIGNATURE is handled as its **own** branch, split from FILE_UPLOAD, and is
**never** subject to `allowedFileTypes` (a signature is implicitly `image/png`;
applying a form's document allow-list to it would wrongly reject every
signature). Rules:

1. Host check (identical to above) — reject non-`res.cloudinary.com`.
2. Type: **png + jpg allowed** for SIGNATURE — i.e. extension must be in
   `{ "png", "jpg", "jpeg" }`, else reject with `"signature must be an image"`.
   Unknown extension → **accept** (same fallback rationale as FILE_UPLOAD).

### Decision: png-only vs png+jpg for SIGNATURE — chosen png+jpg

The SignaturePad uploads a `.png` via `skipCompression: true`, so **png-only**
would match today's client exactly. I nonetheless pin **png + jpg** because it is
strictly safer against false rejections at no security cost: the goal of M1 is
"reject non-image / non-Cloudinary values," and both png and jpg are images on
the form's own Cloudinary folder. Allowing jpg hedges against a future client
tweak or a compression path re-encoding the signature to jpg without reopening
this validator, while still rejecting pdf/docx/exe and any non-Cloudinary host.
The extension set reuses `{png, jpg, jpeg}` — a strict subset of the `image/*`
list — so "SIGNATURE is an image" stays consistent with the FILE_UPLOAD image
definition.

## File size (pinned: not re-checked server-side)

Size is **not** validated server-side. The API never receives the bytes (the
browser uploads straight to Cloudinary; only the resulting URL reaches us), so
`maxFileSizeMB` cannot be enforced here and remains a client-only convenience
check (`PublicFormPage.tsx` ~L905). The signed-upload flow (`signUpload`) signs
only `folder` + `timestamp` and does **not** currently pin a `max_bytes` /
`max_file_size` param, so Cloudinary is not enforcing a hard size cap either —
this is noted as a known residual gap but is explicitly **out of scope for M1**,
which targets HOST + TYPE. (A future hardening item could add a signed
`max_bytes`/eager size constraint to `signUpload`.)

## Error handling (per failure mode)

`validateAnswerAgainstQuestion` returns a `string | null` message (null = valid);
the caller (`validateSubmission`) turns a non-null into a per-field validation
error (HTTP 400 `VALIDATION_ERROR`) — this is the existing contract and we keep
it. All failures below are **recoverable** (client sees a 400 field error; nothing
is persisted) and are **not** logged server-side (consistent with every other
branch of this function — these are ordinary user-input rejections, not
exceptions):

| Operation | Failure condition | Returns (message) | Recoverable? | Logged? |
|---|---|---|---|---|
| String guard | value not a string | `"expected a file URL"` | yes | no |
| URL parse | `new URL(value)` throws | `"expected a file URL"` | yes | no |
| Protocol | not `https:` | `"expected a file URL"` | yes | no |
| Host | hostname ∉ allowed set | `"file must be uploaded to this form"` | yes | no |
| FILE_UPLOAD type | known ext ∉ allowed-set (allow-list set) | `"file type not allowed"` | yes | no |
| SIGNATURE type | known ext ∉ {png,jpg,jpeg} | `"signature must be an image"` | yes | no |
| Unknown ext | ext empty | `null` (accept) | n/a | no |

Messages are user-facing and deliberately generic (no internal host/path
disclosure beyond "this form").

## Input validation summary (per external input)

- **answer value** (untrusted, from submit body): required to be a string (this
  question type stores a single URL string). Type: string. Limits: already capped
  at `MAX_TEXT_LEN` (10 000) by the shared guard at the top of
  `validateAnswerAgainstQuestion`. Behavior on failure: reject per the table.
- **`question.settings.allowedFileTypes`** (trusted, owner-authored, but loosely
  typed `unknown`): optional. Type expected `string[]`; read defensively, non-array
  or non-string members ignored. Behavior on absence/empty: no type restriction
  (host check only). No failure path — a malformed value degrades to "no type
  restriction," never to a crash.

## Invariants and ownership

- **"Every stored FILE_UPLOAD/SIGNATURE answer URL is an https Cloudinary
  delivery URL on `res.cloudinary.com`"** — owned by this validation layer
  (`validateAnswerAgainstQuestion`), because it is the single authoritative
  server-side gate every submit passes through (`validateSubmission`). The client
  `accept`/size checks are UX only and are explicitly not trusted.
- **"Uploaded bytes can only land in the form's own folder"** — owned by the
  signed-upload layer (`signUpload` signing `folder`), unchanged by M1. The
  validator intentionally does not duplicate this (see host-check rationale).

## Files to modify

- `apps/api/src/modules/forms/form.service.ts`
  - Add module-level consts `CLOUDINARY_DELIVERY_HOSTS`, `MIME_EXTENSIONS`, and a
    small pure helper, e.g. `isAllowedUploadUrl(value, { kind, allowedTypes })`
    returning `string | null` — placed near `validateAnswerAgainstQuestion` and
    **exported** so the unit tests can import it directly (matching how
    `computeFunnel`, `matchesAnswerFilter`, etc. are already exported and tested).
  - Split the combined `case "SIGNATURE": case "FILE_UPLOAD":` into two cases, each
    delegating to the helper with the right `kind` (`"file"` vs `"signature"`) and,
    for `"file"`, the parsed `allowedTypes`.
- `apps/api/src/modules/forms/form.service.test.ts` — add the test block below.

No other files change. This keeps the diff tiny and the logic fully unit-testable
as a pure function (no DB, no I/O).

## Testability

The core logic is a pure `(string, options) => string | null` function, so it is
**unit tested** in isolation — no integration test needed. The existing
`validateSubmission` describe block already exercises the wider submit path; one
extra end-to-end-ish assertion (a bad URL inside a full `validateSubmission`
payload) is optional and listed last. A design that needed DB or network to test
this would be the signal to rethink — this one does not.

## Exact unit test cases to add

Add a `describe("FILE_UPLOAD / SIGNATURE url enforcement", …)` block to
`apps/api/src/modules/forms/form.service.test.ts`, importing the exported helper.
Use a realistic delivery URL constant:

```
const OK = "https://res.cloudinary.com/demo/raw/upload/v1700000000/qivo/forms/f1/report.pdf";
```

Required cases (all must assert the exact null/non-null contract):

1. **valid Cloudinary URL passes** — `OK` with `allowedTypes` containing
   `application/pdf` → returns `null`.
2. **non-Cloudinary host rejected** —
   `https://res.cloudinary.com.evil.com/demo/raw/upload/v1/qivo/forms/f1/x.pdf`
   (and separately `https://evil.com/x.pdf`) → returns a non-null message
   (`"file must be uploaded to this form"`). Also assert plain
   `http://res.cloudinary.com/demo/raw/upload/v1/qivo/forms/f1/x.pdf` → rejected.
3. **disallowed extension rejected when `allowedFileTypes` set** — a valid
   `res.cloudinary.com` URL ending `.exe` (or `.pdf` when `allowedTypes` is
   `["image/*"]`) → returns `"file type not allowed"`.
4. **unknown-extension accepted, host still enforced** — valid `res.cloudinary.com`
   URL whose last path segment has no dot
   (`…/qivo/forms/f1/assetwithoutext`) with `allowedTypes = ["application/pdf"]`
   → returns `null`; **and** the same extensionless path on a non-Cloudinary host
   → still rejected (host check wins over the fallback).
5. **SIGNATURE png accepted** — `…/qivo/forms/f1/sig.png` via the `"signature"`
   kind, with the question carrying an (ignored) `allowedFileTypes:
   ["application/pdf"]` to prove SIGNATURE is NOT subject to the file allow-list
   → returns `null`. Add a sibling assertion that `sig.jpg` also returns `null`
   (pins the png+jpg decision).
6. **SIGNATURE non-image rejected** — `…/qivo/forms/f1/sig.pdf` via `"signature"`
   kind → returns `"signature must be an image"`.

Optional (nice-to-have, not required): one `validateSubmission`-level assertion
that a FILE_UPLOAD answer with a non-Cloudinary URL surfaces as a field
validation error, confirming the wiring from the helper through the submit path.

## Out of scope (explicit)

- Server-side file **size** enforcement (no bytes available; see File size).
- Adding a `max_bytes` constraint to `signUpload` (future hardening item).
- Validating the cloud-name or `qivo/forms/<formId>` folder path segments (owned
  by the signed-upload layer).
- Any client (`PublicFormPage.tsx` / `upload.ts`) changes — the client checks
  remain UX-only and are unchanged.
- The other MEDIUM/LOW audit items (M2/M3 analytics sampling, Multi-Entry count
  cap, L1/L2 editor polish) — separate batch items, not designed here.
