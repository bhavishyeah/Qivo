# M1 Design Review — Server-side file-type + host enforcement (FILE_UPLOAD / SIGNATURE)

Reviewed: `c:\Qivo\.agents\tasks\qivo-hardening-batch\m1-design.md`
Reviewer: design-review subagent (fresh context, source-verified)

## Verdict

**APPROVED** — 0 HIGH, 0 MEDIUM findings. (NITs only; NITs do not block.)

All targeted verification points requested by the step passed against the actual
source. The design stands on its own and is implementation-ready.

---

## Verified Assumptions

Each design claim below was checked against the named source file, not taken on
the design's word.

1. **Allowed Cloudinary host (`res.cloudinary.com`).** Confirmed sound.
   `apps/api/src/services/cloudinary.ts` `signUpload` signs only `folder` +
   `timestamp` and returns `{ cloudName, apiKey, timestamp, signature, folder }`.
   The host itself is not produced by `cloudinary.ts` (bytes go direct from
   browser to Cloudinary; the API only hands out a signature), so the host
   cannot be "read from" that file — the design correctly derives it from the
   `secure_url` delivery-host behavior instead and does not fabricate a source.
   The design's reasoning that cloud name is the first **path** segment
   (`/<cloudName>/…`), not part of the host, is consistent with the upload URL
   `https://api.cloudinary.com/v1_1/<cloudName>/<image|raw>/upload` in
   `apps/web/src/lib/upload.ts`. Host is correctly fixed and env-independent.

2. **`secure_url` is stored as the answer.** Confirmed in
   `apps/web/src/lib/upload.ts` `uploadToCloudinary`: resolves `data.secure_url`
   and returns it; `PublicFormPage.tsx` stores that string as the answer value.

3. **Resource-type / extension behavior.** Confirmed in `upload.ts`:
   `resourceType = file.type.startsWith("image/") ? "image" : "raw"`;
   `maybeCompressImage` renames to `.jpg` (`+ ".jpg"`, `type: "image/jpeg"`) and
   is skipped for signatures via `opts.skipCompression`. Matches the design.

4. **`image/*` extension list matches `isImageUrl`.** Confirmed byte-for-byte:
   `upload.ts` `imageExts = ["png","jpg","jpeg","gif","webp","svg","avif","bmp"]`
   equals the design's `MIME_EXTENSIONS["image/*"]`. Server/client agree on "an
   image."

5. **MIME→ext map covers the full allow-list vocabulary.** Confirmed. The builder
   emits exactly 8 MIME values (`FormEditorPage.tsx` checkbox list, lines
   ~1743–1752, and the default `settings.allowedFileTypes` at line 475):
   `image/*`, `application/pdf`, docx, `application/msword` (doc), xlsx,
   `application/vnd.ms-excel` (xls), pptx, `application/vnd.ms-powerpoint` (ppt).
   The design's `MIME_EXTENSIONS` has a key for all 8. `PublicFormPage.tsx`
   `MIME_TO_EXT` / `MIME_FRIENDLY` corroborate the same set. No allow-list entry
   is left unmapped.

6. **Extension-parsing of Cloudinary URLs is sound.** Confirmed by design.
   Parsing `url.pathname`'s last segment and taking `lastIndexOf(".")` with
   `dot > 0` correctly ignores query/fragment and treats dotless segments as
   unknown. `dot > 0` (not `>= 0`) correctly rejects a leading-dot dotfile as
   having no usable extension. Sound against the documented delivery-URL shape.

7. **`question.settings` typing.** Confirmed. `form.service.ts`
   `type FormQuestion = { …; settings?: Record<string, unknown>; … }` (line ~55)
   and `form.schemas.ts` uses `z.record(z.string(), z.unknown()).optional()`.
   Defensive read of `allowedFileTypes` is justified.

8. **`allowedFileTypes` / `maxFileSizeMB` are client-only.** Confirmed. A repo
   grep shows both appear only under `apps/web` (`FormEditorPage.tsx`,
   `PublicFormPage.tsx`, `FormPreviewPage.tsx`); neither string occurs anywhere
   in `apps/api/src`. The design's "confirmed: appear nowhere in apps/api" is
   accurate.

9. **Current status-quo branch.** Confirmed. `form.service.ts`
   `case "SIGNATURE": case "FILE_UPLOAD":` currently only does
   `if (!isString || !/^https?:\/\//.test(value)) return "expected a file URL"`.
   The design's premise (any `https?://` string is accepted today) is exact.

10. **Error contract (`string | null`, caller turns non-null into 400).**
    Confirmed by the surrounding `validateAnswerAgainstQuestion` signature and
    the existing `validateSubmission` describe block in the test file, which
    asserts throw-on-invalid. Design preserves the contract.

11. **Export-and-unit-test pattern.** Confirmed. `matchesAnswerFilter`
    (line ~138) and `computeFunnel` (line ~3038) are `export function`s in
    `form.service.ts` and are imported/tested in `form.service.test.ts`
    (Vitest). The plan to export `isAllowedUploadUrl` and unit-test it matches
    existing precedent.

12. **`MAX_TEXT_LEN` cap applies first.** Confirmed: the shared guard at the top
    of `validateAnswerAgainstQuestion` caps strings at 10 000 before the type
    switch, so the input-validation summary is accurate.

13. **No existing test regresses.** The existing passing SIGNATURE case in
    `form.service.test.ts` (line ~99) uses
    `https://res.cloudinary.com/demo/image/upload/signature.png` — under the new
    rules this still passes (host `res.cloudinary.com` ✓, ext `png` ✓). No
    regression introduced.

## Unverified / Wrong Assumptions

- **None that are wrong.** One claim is inherently external and cannot be
  source-verified in this repo: that `res.cloudinary.com` is Cloudinary's
  default secure delivery host for `secure_url`. This is true of Cloudinary's
  platform behavior and the design does not misattribute it to a repo file (it
  states the derivation explicitly). No code in the monorepo contradicts it. See
  NIT-3 for the one residual-risk note attached to it.

---

## Findings

### NIT-1 — Non-null assertion in the defensive-read snippet is redundant and will trip lint

**Where:** "FILE_UPLOAD type enforcement (pinned)", the `allowed` snippet.

The snippet guards with `question.settings?.allowedFileTypes` then inside the
`Array.isArray(...)` branch casts `question.settings!.allowedFileTypes`. The `!`
non-null assertion is redundant after the optional chain established the value,
and the repo's lint config (TS strict, seen by the `eslint-disable` pragmas in
the test file) may flag `no-non-null-assertion`. It is also simply unnecessary:
the `Array.isArray(x)` check already narrows `x`.

**Concrete fix:** bind once and narrow, dropping the `!`:

```ts
const raw = question.settings?.allowedFileTypes;
const allowed = Array.isArray(raw)
  ? raw.filter((t): t is string => typeof t === "string")
  : [];
```

### NIT-2 — "known ext not in set" path for FILE_UPLOAD when allow-set is empty-but-present is already correct, but worth an explicit test note

**Where:** "FILE_UPLOAD type enforcement" bullet list + "Exact unit test cases".

The logic says: `allowed.length === 0` → host-only (no type restriction). The
map also says an allow-list of only unknown MIMEs yields an empty allow-**set**
while `allowed.length > 0`, so a *known* extension would then hit "known and not
in set → reject." This is the intended behavior and is internally consistent,
but no listed test case exercises "allow-list is non-empty yet expands to an
empty extension set." In practice the builder never emits only-unknown MIMEs
(verified: all 8 builder MIMEs map), so this is not reachable via the UI and does
not block.

**Concrete fix (optional):** add one assertion — `allowedTypes = ["x/unknown"]`
with a `.pdf` URL → expect `"file type not allowed"` — to pin the branch, or add
a one-line comment in the test block stating it is intentionally unreachable from
the builder.

### NIT-3 — SVG included in the image allow-set (inherited client behavior)

**Where:** "Pinned MIME → allowed-extension map", `image/*` includes `svg`.

`svg` is kept to mirror `isImageUrl` exactly (verified identical). SVGs can carry
active content, but in this flow they are Cloudinary delivery URLs rendered by
the existing client and M1 does not change rendering or introduce a new sink.
Flagging only so it is a conscious choice, not an oversight: M1 deliberately
keeps server and client definitions identical, so tightening SVG here would
desync them and is out of scope.

**Concrete fix:** none required for M1. If SVG delivery is later deemed a risk,
address it in both `upload.ts` `imageExts` and `MIME_EXTENSIONS` together as a
separate item so the two stay in lock-step.

---

## Targeted checklist (from the step prompt)

| Requirement | Result |
|---|---|
| Allowed Cloudinary host confirmed against `cloudinary.ts` (not assumed) | PASS — host correctly derived; `cloudinary.ts` signs folder+timestamp only, consistent with design |
| MIME→ext map covers the app's allow-list entries | PASS — all 8 builder MIMEs mapped |
| Cloudinary URL extension-parsing is sound | PASS — pathname-last-segment + `lastIndexOf('.')` with `dot > 0` |
| Unknown-extension fallback is "accept, host still enforced" (no silent hard-fail) | PASS — explicitly pinned for both FILE_UPLOAD and SIGNATURE; host check runs first |
| SIGNATURE policy pinned (png+jpg chosen) and NOT subject to `allowedFileTypes` | PASS — own branch, `{png,jpg,jpeg}`, allow-list explicitly ignored; test case 5 proves it |
| Listed unit tests cover required scenarios | PASS — 6 required cases cover valid, bad host (incl. `.evil.com`, userinfo, http), disallowed ext, unknown-ext-accept + host-wins, SIGNATURE png/jpg accept, SIGNATURE non-image reject |

## Notes on correctness of the security core (not findings)

- Using `new URL().hostname` with an exact `Set` membership test is the correct
  defense against the `res.cloudinary.com.evil.com` and
  `https://res.cloudinary.com@evil.com/` bypasses; both are called out and
  covered by test case 2.
- Protocol pin to `https:` before host check is correct ordering.
- Host check applying unconditionally to both kinds (even with `allowedFileTypes`
  unset) is the right security floor.
