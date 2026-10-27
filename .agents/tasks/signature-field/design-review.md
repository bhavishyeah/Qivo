# Design Review — SIGNATURE question type

Reviewed: `c:\Qivo\.agents\tasks\signature-field\design.md` (the revision that already answered a prior review's 6 findings).
Method: read the design fresh, then verified every "mirrors FILE_UPLOAD" / "existing code does X" claim against the actual source in `c:\Qivo`. Builds and tests were NOT run, per instructions.

This design is a second-round revision. The six prior findings (#1 off() double-duty, #2 `validateSubmission` naming, #3 PNG background + single export, #4 stale settings, #5 onChange wording, #6 version) are each genuinely resolved in the source — I re-verified #2, #4, #6 below. What remains are issues the prior review did not surface.

---

## Findings

### 1. MEDIUM — `maybeCompressImage` is NOT a guaranteed no-op for the signature PNG; it can silently re-encode to JPEG and rename `.png` → `.jpg`

Where: "Capture / upload UX (chosen)" section — the claim *"The `maybeCompressImage` step inside `uploadToCloudinary` is a no-op for a tiny PNG ... we upload the signature PNG as-is ... It is a PNG, not a GIF, so it passes the `image/gif` early-return, then hits the 'already small enough' early-return and is returned unchanged."* Also the matrix row for `upload.ts` ("`maybeCompressImage` no-ops on the tiny PNG").

Why it's wrong: I read `maybeCompressImage` in `apps/web/src/lib/upload.ts`. The logic is:
```ts
if (!file.type.startsWith("image/") || file.type === "image/gif") return file; // PNG does NOT hit this
const bitmap = await createImageBitmap(file);
const scale = Math.min(1, MAX_EDGE / Math.max(width, height)); // MAX_EDGE = 1600
if (scale === 1 && file.size <= 1_000_000) { bitmap.close(); return file; } // only early-returns when BOTH hold
// ...otherwise re-encodes to image/jpeg at QUALITY 0.82, newName = *.jpg
```
The "returned unchanged" path requires **both** `scale === 1` (longest edge ≤ 1600px) **and** `size ≤ 1 MB`. The File produced by `toPngFile()` is exported from the **DPR-scaled backing-store canvas**, whose pixel dimensions are `cssWidth * devicePixelRatio`. The design fixes CSS height at 200px but sets canvas `width: 100%`. On a wide/high-DPI viewport the backing-store width can exceed 1600 (e.g. an ~820px-wide form column at DPR 2 → 1640px, or wider desktop columns, or DPR 3 phones at ≥534px CSS). When the longest edge > 1600, `scale < 1`, the early-return is skipped, and the signature is **re-encoded to JPEG and renamed `signature.jpg`**. So the design's stated reasoning is false, and the "upload PNG as-is, no compression decision needed" guarantee does not hold on common screens.

Severity rationale: not HIGH because `isImageUrl()` accepts `.jpg`, so the thumbnail still renders and the answer is still an https URL — nothing breaks functionally. But the design explicitly leans on "returned unchanged" to justify skipping a compression decision, and that justification is incorrect; a white-background JPEG at quality 0.82 is also a (minor) fidelity regression for line art versus PNG. The coder will implement against a false premise.

Concrete fix (pick one, state it in the design):
- Preferred: bypass `maybeCompressImage` for signatures. Since `SignaturePad` returns a `File` and the parent owns the upload, either (a) add a tiny direct-upload path for the signature blob that skips `maybeCompressImage`, or (b) cap the canvas backing store so the longest edge is always ≤ 1600 (clamp `canvas.width = Math.min(rect.width * dpr, 1600)`), which keeps the PNG on the unchanged path for every viewport. Option (b) is the smallest change and preserves PNG.
- Or: accept JPEG conversion and correct the design text — drop the "returned unchanged / PNG as-is" claim, note the file may arrive as `signature.jpg`, and confirm that is acceptable (it renders fine; the "always `.png` extension" rationale under "Image format" must then also be softened).

### 2. MEDIUM — The public-form Save/re-sign flow references component-local state (`sigRef`, `sigEmpty`) and per-question `SignaturePad` mounting without specifying that `QuestionField` renders one instance per question; the "re-sign clears the URL" wiring is asserted but the existing `QuestionField` has no such state and the hooks-ordering constraint is not addressed

Where: "Capture / upload UX (chosen)" → Public-form lifecycle steps 1–3, and the edge case "Re-sign after save".

What I verified: `QuestionField` in `apps/web/src/pages/PublicFormPage.tsx` already declares `uploading`/`uploadError`/`uploadProgress` as **unconditional** hooks at the top of the component (comment: "unconditional hooks; only used by the FILE_UPLOAD branch"), and `uploadFileToCloudinary` closes over `slug` + `onChange(question.id, …)`. So reusing them for SIGNATURE is sound. However the design introduces `sigRef` (a `useRef`) and `sigEmpty` (a `useState`) that do not exist today and must likewise be declared **unconditionally** at the top of `QuestionField` (same Rules-of-Hooks constraint the existing comment is protecting), not inside the SIGNATURE branch. The design never says this, and a naive implementer may add `useState`/`useRef` inside the `if (question.type === "SIGNATURE")` block, which breaks hook ordering because `QuestionField` renders many branches.

Also: step 3 says re-sign does `onChange(question.id, null)`. I confirmed `onChange`'s value type is `AnswerValue` which includes `null`, so that is type-valid. Good — but the design should state that the SIGNATURE "uploaded" view derives `uploadedUrl` the same way the FILE_UPLOAD branch does (`typeof value === "string" && value.startsWith("http")`), and that `sigEmpty` must be seeded to `true` on mount so the Save button starts disabled.

Concrete fix: in the Public-form lifecycle, add one line: "Declare `const sigRef = useRef<SignaturePadHandle>(null)` and `const [sigEmpty, setSigEmpty] = useState(true)` at the top of `QuestionField` alongside the existing unconditional upload-state hooks (Rules of Hooks — not inside the branch). Derive `uploadedUrl` exactly as the FILE_UPLOAD branch does." State that `sigEmpty` initializes to `true`.

---

### 3. NIT — Approximate line numbers in the design have drifted from the current source

Where: matrix + validation section cite "new-question default settings (~line 459)", "type-change handler (~line 1454)", "FILE_UPLOAD settings panel", "`validateSubmission` ... submit path (around line 1855) ... edit-response path (around line 2153)".

What I verified: new-question defaults are at ~line 459 (correct). The FILE_UPLOAD settings panel is gated `question.type === "FILE_UPLOAD"` at **~line 1666**, not ~1454; the type-change `<select>` handler is at **~line 1448**. `validateSubmission` is indeed called at ~1855 (submit) and ~2153 (edit). Only the editor panel number is materially off.

Severity: NIT — the anchors are "~" and the targets are found by name easily. Fix: change the matrix's "FILE_UPLOAD settings panel" reference to ~line 1666 and clarify the type-change handler is ~line 1448 so the coder lands on the right block.

### 4. NIT — "SignaturePad styled to match the FILE_UPLOAD drop zone" leaves the solid-vs-dashed border a loose "optional"

Where: "`SignaturePad` component API" → Styling paragraph: *"bordered (`2px dashed #cbd5e1` while empty, solid once drawn is optional)"*.

Why minor: "optional" is an unresolved choice in a doc meant to be implementation-ready, but it is purely cosmetic and has one obvious default. Fix: pick one — "keep `2px dashed #cbd5e1` always; do not switch to solid" — so there is no ambiguity.

### 5. NIT — `signature_pad` v5 event-subscription API name is stated two different ways

Where: the "`signature_pad` v5 integration" section and verify-at-install list say to confirm `on()` / `off()`; the "Internal wiring" bullet says `pad.addEventListener("beginStroke", …)` / `("endStroke", …)`, and cleanup uses `pad.off()`.

Why minor: both forms appear in the ecosystem across versions, and the design already (correctly) mandates verifying the exact API against the installed package's types before writing the component, which neutralizes the risk. But `addEventListener` + `off()` as a *pair* is internally inconsistent (one is DOM-style, the other is the library's own method). Fix: state the pair explicitly as "subscribe with `pad.addEventListener(...)` and tear down with `pad.removeEventListener(...)` (or the library's `on`/`off` — whichever the installed v5 types expose; confirm at install and use a matched pair)." Keep subscribe/teardown symmetric.

---

## Verified Assumptions (checked against source, correct)

1. **Web `QuestionType` union & `AnswerValue`** — `apps/web/src/types/index.ts`: union lists `FILE_UPLOAD` (no `SIGNATURE`); `AnswerValue = string | number | string[] | boolean | null`. One-line union add is correct; `null` is a valid answer value (needed for re-sign). ✓
2. **`uploadToCloudinary(slug, rawFile, onProgress)` signature & resource-type logic** — `apps/web/src/lib/upload.ts`: exact signature; `resourceType = file.type.startsWith("image/") ? "image" : "raw"`, so an `image/png` File auto-selects `"image"`. ✓
3. **`isImageUrl`** — extension-keyed; `.png` (and `.jpg`) return true → thumbnail everywhere. ✓
4. **`uploadFileToCloudinary` wrapper + `uploading`/`uploadError`/`uploadProgress` unconditional hooks** — exist in `PublicFormPage.tsx`'s `QuestionField`, wrapper calls `onChange(question.id, secureUrl)` on success and manages progress/error. ✓
5. **API `questionTypeSchema` z.enum** — `form.schemas.ts`: enum lists `FILE_UPLOAD`, no `SIGNATURE`; one-line add correct. `editResponseSchema = submitResponseSchema.extend(...)`. ✓
6. **`validateAnswerAgainstQuestion` fall-through** — `form.service.ts` ~line 1355: `case "FILE_UPLOAD":` body is `if (!isString || !/^https?:\/\//.test(value)) return "expected a file URL"; return null;`. A `case "SIGNATURE":` stacked immediately above falls through into it. ✓
7. **`validateSubmission` is the real exported name** (not `assertAnswersValid`) and is called by BOTH submit (~1855) and edit (~2153). Required loop treats a non-empty string as present: `answer === undefined || null || "" → missing`; MULTI_ENTRY is the only special-case; SIGNATURE needs none. ✓
8. **`getFormReport` text bucket by omission** — `form.service.ts`: choice branch matches SINGLE_CHOICE/MULTIPLE_CHOICE/YES_NO; rating branch RATING/LINEAR_SCALE; number NUMBER; MULTI_ENTRY its own; everything else falls to `kind: "text", sample = answers.map(String)`. SIGNATURE matches none → text bucket, exactly like FILE_UPLOAD. ✓
9. **Local `QuestionType` unions** — `form.service.ts` (~line 24) and `FormReportsPage.tsx` (~line 53) each have their own union listing `FILE_UPLOAD`; both need the one-line add. ✓
10. **FILE_UPLOAD editor settings panel is type-gated** `question.type === "FILE_UPLOAD"` (so it won't render for SIGNATURE automatically). ✓
11. **Type-change handler does NOT clear `settings`** when leaving FILE_UPLOAD (~line 1448) — it only resets `options` for choice types and sets `settings` for rating/scale. Finding #4 of the prior review is correctly characterized: leftover `maxFileSizeMB`/`allowedFileTypes` are inert for SIGNATURE. ✓
12. **`FormPreviewPage` static FILE_UPLOAD branch** ("Click to upload (preview only)") and **no local `QuestionType` union** (it imports `Question` from `../types`), so no union edit is needed there — and the design does not claim one. ✓
13. **`ResponseDashboardPage.renderAnswerValue`** — https URL + `isImageUrl` → `<img>` thumbnail, else "View file"; arrays → `<Chips>`. CSV/Excel export writes the URL as text. No change for SIGNATURE. ✓
14. **`FormReportsPage.renderSampleAnswer` / `TextSummary`** — `/^https?:\/\//` + `isImageUrl` → thumbnail; text report routes to `TextSummary`. No change for SIGNATURE. ✓
15. **`signature_pad` absent from `apps/web/package.json`** — confirmed not yet a dependency; a new pinned dependency is required, as the design states. ✓
16. **`MAX_TEXT_LEN = 10_000`** cap in `validateAnswerAgainstQuestion` applies to all strings; a Cloudinary URL is well under it. ✓

## Unverified / Wrong Assumptions

- **WRONG — "`maybeCompressImage` no-ops on the tiny PNG / PNG uploaded as-is / returned unchanged."** See Finding #1. The no-op path requires longest edge ≤ 1600px AND size ≤ 1 MB; the DPR-scaled canvas can exceed 1600px wide on common viewports, forcing a JPEG re-encode and `.jpg` rename. The GIF early-return does NOT apply to PNG.
- **UNVERIFIED (correctly self-flagged by the design) — `signature_pad@5.1.4` resolvability and exact v5 API** (`default` export, `isEmpty`/`clear`/`addEventListener`/`off`, `beginStroke`/`endStroke`, `backgroundColor` option). I did not run `npm`/`pnpm view` (network/registry not exercised in this review) and the package is not installed, so I cannot confirm the version or the method names from source. The design's mandated verify-at-install step is the right mitigation; see Finding #5 for the `addEventListener`-vs-`on`/`off` inconsistency to resolve at that step.
- **UNVERIFIED — exact DPR/canvas pixel math at runtime.** The ≥1600px threshold claim in Finding #1 is derived from the CSS layout + DPR formula and the `.public-form-wrap` column, not measured in a browser; the direction (wide/high-DPI can cross 1600) is certain, the precise breakpoint depends on the deployed CSS width of `.public-form-wrap`.

---

## Verdict

HIGH: 0 · MEDIUM: 2 · NIT: 3 → **CHANGES_REQUESTED** (any HIGH/MEDIUM blocks).

Resolve findings #1 and #2 (and ideally the NITs) and the design is ready. Both MEDIUMs are about the design relying on stated-but-inaccurate premises (PNG passthrough; implicit hook placement for new state), not about the FILE_UPLOAD-mirroring strategy, which is sound and correctly traced through every layer.
