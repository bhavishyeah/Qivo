# Design — SIGNATURE question type

## Overview

Add a new `SIGNATURE` question type to the Qivo form-builder monorepo. A signature question presents the respondent a canvas to draw their signature (mouse / touch / stylus), captured as a PNG and uploaded to Cloudinary; the stored answer is the resulting `https://…` secure URL — byte-for-byte the same answer shape as the existing `FILE_UPLOAD` type.

The guiding principle, confirmed by reading the code: **`SIGNATURE` is handled identically to `FILE_UPLOAD` at every layer except the capture widget.** Because the answer is an `https` URL in both cases, the validation rule, the required-check, the report bucket, the response-dashboard rendering, the CSV/Excel export, and the Cloudinary upload endpoint are all either already-shared code paths or a one-line addition that puts `SIGNATURE` next to `FILE_UPLOAD`. The only genuinely new code is a reusable `SignaturePad` React component and the two render branches (public form + preview page) that mount it. This mirrors how `MULTI_ENTRY` was recently added.

The upload path is the existing `uploadToCloudinary(slug, file, onProgress)` in `apps/web/src/lib/upload.ts` (note: the function is named `uploadToCloudinary`, not `uploadFileToCloudinary`; the latter is a local wrapper inside `PublicFormPage`'s `QuestionField`). It takes a `File`; a canvas `toBlob` → `File` feeds it directly. The signing endpoint `POST /api/forms/public/:slug/upload-signature` is form-scoped and already public — unchanged.

## Technology stack (locked once approved)

- **Capture library:** `signature_pad` — pinned to **`5.1.4`**. This version was confirmed resolvable at authoring time via `npm view signature_pad version` → `5.1.4` (it is the current `latest` and the latest v5). It is a tiny (~5 KB gzip), dependency-free, framework-agnostic library that handles pointer/touch/stylus events, pressure-variable line width, and high-DPI canvases. Added to `apps/web/package.json` `dependencies` as `"signature_pad": "5.1.4"` (exact pin, no caret, matching the task's "pin the exact version" requirement). Install with `pnpm install` (the repo uses pnpm). **Verify-at-install:** re-run `pnpm view signature_pad version` when installing; if `5.1.4` is somehow unavailable, pin the nearest resolvable v5 (still an exact, no-caret pin) and confirm the v5 API shape this design relies on — default export; instance methods `isEmpty()`, `clear()`, `on()`, `off()`; the `beginStroke`/`endStroke` events; and the constructor `backgroundColor` option — against the installed package's types/README before writing the component.
- **Image format:** PNG, produced by `canvas.toBlob(cb, "image/png")`. The pad is constructed with an **opaque white background** (`backgroundColor: "rgb(255,255,255)"`) so the exported PNG is never transparent (see the export-path decision below); the `.png` extension makes `isImageUrl()` return `true` so the URL renders as a thumbnail everywhere.
- **Upload transport:** the existing `uploadToCloudinary` XHR flow, `resourceType = "image"` (chosen automatically because the generated `File` has `type === "image/png"`, which `file.type.startsWith("image/")` detects).
- No backend libraries change. No Prisma schema change (answers live in the existing `FormResponse.answers` JSON).

## `signature_pad` v5 integration

`signature_pad` v5 default-exports the `SignaturePad` class:

```ts
import SignaturePad from "signature_pad";
```

Construction (note the explicit opaque background, which resolves the transparent-vs-white question — see the export decision):

```ts
const pad = new SignaturePad(canvasEl, { backgroundColor: "rgb(255,255,255)" });
```

The library draws to the canvas you give it but does **not** manage the canvas backing-store size. For crisp high-DPI output we own the resize logic (the documented pattern):

1. On mount and on every resize, set `canvas.width = rect.width * devicePixelRatio`, `canvas.height = rect.height * devicePixelRatio`, then `canvas.getContext("2d").scale(dpr, dpr)`.
2. Resizing the backing store clears it, which also clears both the drawn signature **and the white background fill**. `signature_pad` only re-paints its `backgroundColor` inside `clear()`, so after every DPR resize we call `pad.clear()` — this both (a) restores the opaque white fill the export depends on and (b) gives a clean empty canvas (we do not attempt to re-render stroke data, since our capture model is "draw then press Save" and signatures are short-lived). We debounce resize so an in-progress stroke on a rotating phone isn't wiped mid-draw. (A respondent who rotates mid-signature re-signs — acceptable and rare.) **The resize rule and the white-fill rule are the same call — keep them together.**
3. CSS sets the canvas `width: 100%` and a fixed `height` (200px); the backing store is DPR-scaled off the measured CSS box.

Emptiness: `signaturePad.isEmpty()` is authoritative. Clear: `signaturePad.clear()`.

**Single export path — decided.** Export the PNG via `canvas.toBlob(...)` on the **same canvas element the pad draws on** (which is already DPR-scaled), **not** `signaturePad.toDataURL()`. Using one path avoids double-applying or dropping the DPR scale and avoids a base64 round-trip; because the pad was constructed with `backgroundColor: "rgb(255,255,255)"`, that canvas already carries an opaque white fill, so the exported PNG shows black strokes on white — correct on the light FILE_UPLOAD thumbnail cards and safe for any viewer that composites transparency to black.

```ts
toPngFile: () => new Promise<File | null>((resolve) => {
  if (pad.isEmpty()) return resolve(null);          // nothing drawn
  canvas.toBlob(
    (blob) =>
      resolve(blob ? new File([blob], "signature.png", { type: "image/png" }) : null),
    "image/png",                                     // encode failure → null, surfaced inline
  );
}),
```

## `SignaturePad` component API

New file `apps/web/src/components/SignaturePad.tsx`. A controlled-by-ref component usable by both the public form (uploads) and the preview page (interactive, no upload). It renders its own canvas + Clear button and exposes imperative methods via `ref`; it does **not** know anything about uploading.

```ts
export type SignaturePadHandle = {
  isEmpty: () => boolean;
  clear: () => void;
  /** Resolves to a PNG File, or null if the pad is empty / encode failed. */
  toPngFile: () => Promise<File | null>;
};

export type SignaturePadProps = {
  /** Fires on every beginStroke/endStroke and after clear, reporting the
   *  current pad.isEmpty(). Lets callers toggle a Save button and clear a stale
   *  uploaded URL. Idempotent — safe to call on each stroke. */
  onChange?: (isEmpty: boolean) => void;
  /** Disable drawing (e.g. while an upload is in flight). Default false.
   *  Enforced at the parent via CSS pointer-events, NOT via pad.off() — see
   *  the disable contract below. */
  disabled?: boolean;
  height?: number; // canvas CSS height in px, default 200
  ariaLabel?: string;
};

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(...);
export default SignaturePad;
```

Rationale for ref + `onChange(isEmpty)` rather than `onChange(blob)` on every stroke: we do **not** want to upload or re-encode on each stroke. The parent decides *when* to materialize the PNG (on "Save signature"). `onChange(isEmpty)` is cheap and is exactly what both consumers need to toggle button state. It fires on **every** `beginStroke`/`endStroke` (not only the first stroke) and on clear; each call reports `pad.isEmpty()`, which is idempotent, so the parent just does `setSigEmpty(empty)` with no first-stroke tracking. `toPngFile()` is pulled on demand.

**Disable contract — decided (resolves the `off()` ambiguity).** `pad.off()` is reserved **exclusively for unmount teardown** (it detaches all pointer/touch listeners). The transient "disable during upload" is **not** done with `off()`/`on()` — instead the component renders the canvas inside a wrapper that applies `pointerEvents: "none"` and reduced opacity while `disabled` is true. This keeps teardown and transient-disable as two distinct mechanisms (no shared method doing double duty), and guarantees the pad is never left dead after a failed upload — when `disabled` flips back to false the CSS gate simply lifts and drawing resumes, with no library call to forget. (The alternative — calling `pad.off()` to disable and `pad.on()` to re-enable in a `disabled`-dependent effect — is viable but rejected because it overloads `off()` and risks a missing `on()` leaving the pad permanently dead; the CSS gate is simpler and failure-proof.)

Internal wiring:
- `useRef` for the `<canvas>`, the `SignaturePad` instance, and the latest `onChange` (to avoid re-subscribing listeners when the callback identity changes).
- Mount `useEffect` (runs once): construct `new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" })`, run the DPR resize + `pad.clear()`, attach a debounced `window` resize listener (resize → DPR re-measure → `pad.clear()`), and register `pad.addEventListener("beginStroke", …)` / `("endStroke", …)` to call `onChangeRef.current?.(pad.isEmpty())`. **Cleanup (teardown only): `pad.off()` + remove the resize listener.**
- A separate `disabled`-dependent effect does nothing to the library; the CSS `pointer-events`/opacity gate lives in the rendered wrapper (`style={{ pointerEvents: disabled ? "none" : "auto", opacity: disabled ? 0.6 : 1 }}`).
- Clear button calls `pad.clear()` then `onChange(true)`.
- `useImperativeHandle` exposes `isEmpty`, `clear`, `toPngFile`.

Styling matches the FILE_UPLOAD drop zone aesthetic: bordered (`2px dashed #cbd5e1` while empty, solid once drawn is optional), `borderRadius: 12`, light background, with a muted "Sign above" hint and the Clear button beneath.

## Capture / upload UX (chosen)

**Decision: explicit "Save signature" button**, not upload-on-every-stroke.

Rationale: uploading each stroke would fire dozens of Cloudinary requests for one signature, waste the signing endpoint, and race (later strokes finishing before earlier ones). An explicit Save makes the upload moment deterministic, maps cleanly onto the existing `uploading → uploaded` UI, and matches the FILE_UPLOAD mental model ("pick, then it uploads"). The button is disabled while the pad is empty and while an upload is in flight.

Public-form lifecycle (inside `QuestionField`, reusing the existing `uploadFileToCloudinary` wrapper + `uploading`/`uploadError`/`uploadProgress` state that already live in the component):
1. Render `<SignaturePad ref={sigRef} disabled={uploading} onChange={(empty) => setSigEmpty(empty)} />`.
2. "Save signature" button (disabled when `sigEmpty || uploading`): `const file = await sigRef.current?.toPngFile(); if (file) await uploadFileToCloudinary(file);`. `uploadFileToCloudinary` already calls `onChange(question.id, secureUrl)` on success and manages the progress bar / error text.
3. After success (`value` is the `https` URL), show the **same "uploaded" UI as FILE_UPLOAD**: the thumbnail (`isImageUrl(url)` is true for `.png`), a "✓ Signature saved · view" link, and a "Re-sign" affordance. Re-sign = clear the pad, clear the stored URL (`onChange(question.id, null)`), and let them draw + Save again.

No new failure modes: if Cloudinary is not configured, the signing endpoint throws exactly as it does for FILE_UPLOAD and the inline `uploadError` shows the same message. The `maybeCompressImage` step inside `uploadToCloudinary` is a no-op for a tiny PNG (it only down-scales when the longest edge exceeds 1600px and size > 1 MB), so **no separate compression decision is needed** — we upload the signature PNG as-is and rely on the existing guard to leave it untouched. (It is a PNG, not a GIF, so it passes the `image/gif` early-return, then hits the "already small enough" early-return and is returned unchanged.)

Preview-page lifecycle (`FormPreviewPage`): mount the **same** `SignaturePad` component so the respondent can really draw and clear, but render **no Save button and no upload** — preview never persists. This satisfies the "live working canvas in preview, but not saved" requirement with zero duplicated canvas code.

Editor-page: a **static placeholder only** (no live canvas). A bordered box labeled "Signature" with a muted "Respondent signs here" hint, mirroring how the editor shows static previews for other types.

## Validation & invariants

- **Answer type (server, authoritative):** `validateAnswerAgainstQuestion` in `form.service.ts`. Add `case "SIGNATURE":` immediately above `case "FILE_UPLOAD":` so SIGNATURE **falls through** into the FILE_UPLOAD body (`if (!isString || !/^https?:\/\//.test(value)) return "expected a file URL"`). Stacking the labels keeps one rule and one error string; chosen over a copy so the two can never drift. The server owns this invariant because the client is untrusted — a crafted submit could put arbitrary JSON in `answers[questionId]`, and this is the only place the URL shape is enforced before persistence.
- **Required check:** owned by `validateSubmission(schema, answers)`'s visibility-aware required loop (`value === undefined || null || "" → skip/flag`). This is the exported function in `form.service.ts` (NOT `assertAnswersValid`, which does not exist) that holds the unknown-question rejection, the required loop, and the `validateAnswerAgainstQuestion` loop. A SIGNATURE answer is a non-empty URL string, exactly like FILE_UPLOAD, so it is "present" when a URL exists and "missing" otherwise. **No special-casing** (unlike MULTI_ENTRY, which needed an empty-array case). Because `validateSubmission` is called by **both** the submit path (around line 1855) **and** the edit-response path (around line 2153, the `editResponseSchema` flow), SIGNATURE validation and required-enforcement apply to the response-editing window automatically — no extra work. Client mirrors this: the submit button's required check treats the stored URL as the value; required ⇒ a URL must exist, optional ⇒ blank is allowed (matches the user's rule "if required the user must sign; if not required keep it blank").
- **External input (the uploaded bytes):** validated by Cloudinary's signed upload, not by us — same as FILE_UPLOAD. The signing endpoint only authorizes *a* upload into `qivo/forms/<formId>`; it does not inspect content. We accept that parity. The only field we read back is `secure_url`.
- **Font/length caps:** the generic `MAX_TEXT_LEN` (10 000) string cap in `validateAnswerAgainstQuestion` applies to the URL string automatically; a Cloudinary URL is well under it.

## Full lifecycle matrix — every FILE_UPLOAD touch-point

| Layer / file | FILE_UPLOAD today | SIGNATURE change | Shared path? |
|---|---|---|---|
| `apps/web/src/types/index.ts` — `QuestionType` union | member `"FILE_UPLOAD"` | add `"SIGNATURE"` to the union | one-line add |
| `apps/web/src/types/index.ts` — `AnswerValue` | `string` URL | unchanged (URL string) | shared |
| `apps/api/.../form.schemas.ts` — `questionTypeSchema` z.enum | `"FILE_UPLOAD"` | add `"SIGNATURE"` to the enum | one-line add |
| `apps/api/.../form.service.ts` — local `QuestionType` union | `"FILE_UPLOAD"` | add `"SIGNATURE"` | one-line add |
| `apps/api/.../form.service.ts` — `validateAnswerAgainstQuestion` | `case "FILE_UPLOAD"` → https-URL check | add `case "SIGNATURE":` stacked above FILE_UPLOAD (fall-through) | **shared code path** |
| `apps/api/.../form.service.ts` — required check in `validateSubmission` (shared by submit AND edit) | URL non-empty ⇒ present | none (URL behaves identically); applies to the edit window for free | shared |
| `apps/api/.../form.service.ts` — `isQuestionVisibleFor` | no special casing | none | shared |
| `apps/api/.../form.service.ts` — `getFormReport` | FILE_UPLOAD is **not** matched by the choice/rating/number/multi-entry branches, so it lands in the final `text` bucket (`sample = answers.map(String)`) | none — SIGNATURE also matches none of those branches and lands in the same `text` bucket; URLs become thumbnails downstream | shared (by omission) |
| `apps/api/.../form.service.ts` — `getUploadSignatureForForm` + `services/cloudinary.ts` | form-scoped public signing endpoint | none | shared, unchanged |
| `apps/web/src/lib/upload.ts` — `uploadToCloudinary` / `maybeCompressImage` / `isImageUrl` | image → `resourceType "image"`, thumbnail for `.png` | none — PNG File auto-selects "image"; `maybeCompressImage` no-ops on the tiny PNG; `isImageUrl` true for `.png` | shared, unchanged |
| `apps/web/src/pages/PublicFormPage.tsx` — `QuestionField` | FILE_UPLOAD drop-zone + `uploadFileToCloudinary` | **new branch**: `SignaturePad` + "Save signature" → same `uploadFileToCloudinary(file)`; reuse uploaded-state thumbnail UI | reuses upload path; new capture UI |
| `apps/web/src/pages/FormPreviewPage.tsx` | static "preview only" drop zone | **new branch**: live `SignaturePad`, no Save, no upload | new (interactive, non-persisting) |
| `apps/web/src/pages/FormEditorPage.tsx` — `QUESTION_TYPE_LABELS` | `FILE_UPLOAD: "File upload"` | add `SIGNATURE: "Signature"` (also appears in both type `<select>`s via `Object.keys`) | one-line add |
| `apps/web/src/pages/FormEditorPage.tsx` — new-question default settings (~line 459) + type-change handler (~line 1454) | injects `settings` for FILE_UPLOAD; type-change handler resets options for choice types and sets settings for rating types, but does **not** clear `settings` when leaving FILE_UPLOAD | none — SIGNATURE needs no default settings. Switching an existing FILE_UPLOAD question to SIGNATURE leaves `settings.maxFileSizeMB`/`allowedFileTypes` behind, but these are **inert** (the SIGNATURE render branches and server validation both ignore `settings`), so no explicit reset is required for correctness. Optionally clear them in the type-change handler (`patch.settings = undefined` when `newType === "SIGNATURE"`) for tidiness. | no change needed (optional cleanup) |
| `apps/web/src/pages/FormEditorPage.tsx` — FILE_UPLOAD settings panel (`question.type === "FILE_UPLOAD"`) | max-size + allowed-types controls | **must NOT render for SIGNATURE** — already type-gated to `=== "FILE_UPLOAD"`, so automatic; add a separate small static "Signature" placeholder block gated on `=== "SIGNATURE"` | new placeholder block |
| `apps/web/src/pages/FormReportsPage.tsx` — `renderSampleAnswer` / `TextSummary` | URL → thumbnail via `/^https?:\/\//` + `isImageUrl` | none — SIGNATURE URLs render identically (they arrive in the `text`-kind report) | shared |
| `apps/web/src/pages/FormReportsPage.tsx` — local `QuestionType` union | `"FILE_UPLOAD"` | add `"SIGNATURE"` (keep the local union in sync) | one-line add |
| `apps/web/src/pages/ResponseDashboardPage.tsx` — `renderAnswerValue` | image URL → thumbnail, else "View file" | none — `.png` URL → thumbnail automatically | shared |
| `apps/web/src/pages/ResponseDashboardPage.tsx` — CSV/Excel export | URL exported as text | none | shared |
| `apps/web/package.json` | — | add `"signature_pad": "5.1.4"` | new dependency |
| `apps/web/src/components/SignaturePad.tsx` | — | **new reusable component** | new |

## Edge cases

- **Empty pad + required:** "Save signature" is disabled while empty; submit's required check fails because no URL was stored. Matches FILE_UPLOAD-missing behavior and the user's "must sign" rule.
- **Empty pad + optional:** respondent skips; answer stays blank/null; passes validation.
- **Re-sign after save:** Clear → pad empty, stored URL cleared (`onChange(id, null)`), Save re-enabled; a new upload overwrites the answer with a fresh Cloudinary URL. The previous asset is orphaned in Cloudinary — identical to FILE_UPLOAD "Click to replace"; out of scope to garbage-collect.
- **High-DPI / resize:** DPR-scaled backing store; debounced resize clears the pad (documented tradeoff) so the drawn line is never blurry.
- **`toBlob` returns null (encode failure):** `toPngFile()` resolves `null`; the Save handler surfaces the standard inline upload error and does not call `onChange`. Not fatal — the respondent can retry.
- **Cloudinary not configured:** signing endpoint throws `UPLOAD_NOT_CONFIGURED`/404 exactly as for FILE_UPLOAD; inline `uploadError` shows the same message. No new handling.
- **Upload network failure / non-2xx / missing `secure_url`:** `uploadToCloudinary` rejects; `uploadFileToCloudinary` catches and sets `uploadError`; recoverable (retry Save).
- **Preview submit:** disabled by design; the canvas is interactive but nothing persists.

## Error handling (per failing operation)

| Operation | Failure condition | Recoverable? | Caller receives | Logged? |
|---|---|---|---|---|
| `canvas.toBlob` | browser returns null | yes (retry) | `toPngFile()` → `null`; Save shows inline error, no `onChange` | no (client, transient) |
| Signature request (`/upload-signature`) | form not published / Cloudinary unconfigured | no (respondent can't fix) | thrown → `uploadError` inline text (same as FILE_UPLOAD) | server already logs the route error |
| Cloudinary upload XHR | network error / non-2xx / no `secure_url` | yes (retry Save) | reject → `uploadError` = "Upload failed. Please try again." | no (client) |
| Server submit validation | answer not an https URL (crafted client) | n/a (attack) | `INVALID_RESPONSE` 4xx, field-level message "expected a file URL" | per existing submit error handling |

All of these are the exact paths FILE_UPLOAD already exercises; no new error taxonomy is introduced.

## Testability

- **Unit (API, vitest):** `validateAnswerAgainstQuestion` for `type: "SIGNATURE"` — accepts `https://…png`, rejects non-URL / non-string. Add a case next to the existing FILE_UPLOAD test. The required-check and `getFormReport` text-bucket behavior are covered by reusing the FILE_UPLOAD assertions with a SIGNATURE question.
- **Unit (web, vitest):** `SignaturePad` — `isEmpty()` true on mount, false after a simulated stroke; `clear()` resets; `toPngFile()` returns a `File` with `type: "image/png"` once drawn and `null` when empty. Canvas drawing in jsdom is limited, so stroke simulation stubs the `signature_pad` instance (inject via a thin seam) or asserts the wiring (event listeners → `onChange`) rather than pixel output.
- **Integration / manual:** draw on PublicFormPage (mouse + touch), Save, confirm the stored answer is a Cloudinary URL, the thumbnail renders, the response dashboard and reports page show the thumbnail, and CSV export contains the URL. Preview page: draw + clear works, nothing uploads.
- **Design-for-test note:** keeping `SignaturePad` upload-agnostic (ref returns a `File`; parent owns upload) is what makes it unit-testable without network — the hard-to-test Cloudinary call stays in the already-shared `uploadToCloudinary` helper.

## Out of scope

- Garbage-collecting orphaned Cloudinary assets on re-sign (parity with FILE_UPLOAD).
- Typed/drawn-name signatures, signature fonts, or legal e-sign semantics (timestamp, audit certificate).
- Re-rendering stroke data across a resize (we clear instead).
- Any backend upload/storage change — the signing endpoint and Cloudinary service are reused unchanged.

## Responses to design review findings

Review: `c:\Qivo\.agents\tasks\signature-field\design-review.md` (verdict CHANGES_REQUESTED — 1 HIGH, 2 MEDIUM, 3 NIT). All six findings addressed below; each change aligns with the original requirements (SIGNATURE mirrors FILE_UPLOAD at every layer except the capture widget).

- **#1 (HIGH — `pad.off()` double-duty / unspecified re-enable): ADDRESSED.** The component API section now pins the contract explicitly: `pad.off()` is used **only** for unmount teardown; the transient "disable during upload" is done at the parent via a CSS `pointer-events: none` + reduced-opacity wrapper, never via `off()`/`on()`. Stated the chosen approach and why the library-toggle alternative was rejected (risk of a missing `on()` leaving the pad dead after a failed upload).

- **#2 (MEDIUM — `assertAnswersValid` misnamed): ADDRESSED.** Verified against source: the real exported function is `validateSubmission(schema, answers)` in `form.service.ts`. Renamed every reference in the Validation & invariants section and the lifecycle matrix, and added that it is shared by both submit (~line 1855) and edit (~line 2153), so SIGNATURE validation/required-enforcement covers the response-editing window for free.

- **#3 (MEDIUM — PNG background + single export path underspecified): ADDRESSED.** Pinned both: the pad is constructed with `backgroundColor: "rgb(255,255,255)"` (opaque white, chosen over transparent for safe rendering on light thumbnail cards and transparency-compositing viewers), and export goes through a single path — `canvas.toBlob(..., "image/png")` on the same DPR-scaled canvas the pad draws on, never `toDataURL()`. Also called out that each DPR resize must be followed by `pad.clear()` to restore the white fill, tying the resize rule and the background rule together.

- **#4 (NIT — stale FILE_UPLOAD settings on type switch): ADDRESSED.** Verified the type-change handler (~line 1454) does not clear `settings`. Noted in the matrix that leftover `maxFileSizeMB`/`allowedFileTypes` are inert because SIGNATURE reads no settings, with an optional one-line tidy-up (`patch.settings = undefined`) offered. Not required for correctness.

- **#5 (NIT — `onChange` "first stroke" overstated): ADDRESSED.** Reworded the prop doc and rationale: `onChange` fires on every `beginStroke`/`endStroke` (and clear), reporting the idempotent `pad.isEmpty()`; no first-stroke tracking.

- **#6 (NIT — version unverifiable in review): ADDRESSED / VERIFIED.** Ran `npm view signature_pad version` during this revision → `5.1.4` resolves and is the current latest v5. Kept the exact no-caret pin and added an explicit verify-at-install step (re-run `pnpm view`, confirm the `default export` / `isEmpty` / `clear` / `on` / `off` / `beginStroke` / `endStroke` / `backgroundColor` API against the installed types) so the coder confirms rather than assumes.
