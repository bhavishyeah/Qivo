# Verification — SIGNATURE question type

First iteration (no `impl-review.json` present). Implemented per `design.md` +
`plan.md`, applying all 5 findings in `design-verdict.json`.

## Dependency

- `pnpm view signature_pad version` → `5.1.4` (current latest v5).
- Added `signature_pad@5.1.4` (exact pin) to `apps/web/package.json` via
  `pnpm add signature_pad@5.1.4 --save-exact`. Resolved cleanly; recorded in
  `pnpm-lock.yaml`.
- v5 event API confirmed against the installed types
  (`node_modules/.pnpm/signature_pad@5.1.4/.../dist/types/`):
  `SignaturePad extends SignatureEventTarget`, which exposes
  `addEventListener`/`removeEventListener` (matched pair, used for
  `beginStroke`/`endStroke`), plus `on()`/`off()` (used `off()` only for
  unmount teardown). `isEmpty()`, `clear()`, and the `backgroundColor`
  constructor option all present.

## Commands run and results

| Command | Dir | Result |
|---|---|---|
| `pnpm exec tsc --project tsconfig.json --noEmit` | `apps/api` | exit 0 |
| `pnpm exec tsc -b --noEmit` | `apps/web` | exit 0 |
| `pnpm test` (vitest run) | `apps/api` | 3 files, 25 tests passed (incl. 4 new SIGNATURE cases) |
| `pnpm test` (vitest run) | `apps/web` | 3 files, 29 tests passed |
| `pnpm build` (`tsc -b && vite build`) | `apps/web` | exit 0; 637 modules; `signature_pad` resolved & bundled |
| `pnpm exec eslint <changed files>` | `apps/web` | No react-hooks violations in any changed/new file. See note below. |

### Lint note

`pnpm lint` (whole repo) is slow and exceeded the 180s harness timeout, but
emitted full results first. Scoped lint of the changed files surfaces exactly
3 errors, all PRE-EXISTING and UNRELATED to SIGNATURE:

- `FormEditorPage.tsx:217` — `Date.now()` in `pushHistory` (history debounce).
- `FormEditorPage.tsx:302` — `deleteEditorQuestion` used before declaration.
- `PublicFormPage.tsx:268` — `Date.now()` in the submit flow.

None are in `SignaturePad.tsx`, the new SIGNATURE branches, or the new
QuestionField hooks. Crucially there is NO Rules-of-Hooks error in QuestionField
(the new `sigRef`/`sigEmpty` hooks are declared unconditionally at the top),
confirming Finding #2.

## The 5 review findings — how each was applied

1. **MEDIUM — compression bypass.** `uploadToCloudinary` gained an
   `opts?: { skipCompression?: boolean }` param; when set it uploads `rawFile`
   directly (no `maybeCompressImage`). The SIGNATURE "Save signature" handler is
   the ONLY caller passing `{ skipCompression: true }`; FILE_UPLOAD still
   compresses. Signature stays a crisp `image/png` → `.png` URL → thumbnail.
2. **MEDIUM — Rules of Hooks.** `const sigRef = useRef<SignaturePadHandle>(null)`
   and `const [sigEmpty, setSigEmpty] = useState(true)` are declared at the TOP
   of `QuestionField` alongside the existing unconditional upload hooks, not
   inside the branch. `uploadedUrl` derived exactly as FILE_UPLOAD
   (`typeof value === "string" && value.startsWith("http")`).
3. **NIT — accurate refs.** FILE_UPLOAD settings panel is type-gated to
   `=== "FILE_UPLOAD"` so it does not render for SIGNATURE; type-change handler
   updated (adds `patch.settings = undefined` for SIGNATURE tidiness).
4. **NIT — border.** `SignaturePad` uses `2px dashed #cbd5e1` ALWAYS (never
   switches to solid).
5. **NIT — event API.** Matched pair only: `addEventListener`/`removeEventListener`
   for stroke events; `off()` reserved strictly for unmount teardown. No mixing.

## End-to-end trace (code-level)

- (a) **Editor:** `SIGNATURE: "Signature"` added to `QUESTION_TYPE_LABELS`, so it
  appears in both type selectors (they map `Object.keys`). FILE_UPLOAD settings
  panel does not render for SIGNATURE; a static bordered "Signature — respondent
  signs here" placeholder renders instead.
- (b) **Public form:** `<SignaturePad>` → "Save signature" →
  `sigRef.current.toPngFile()` → `uploadFileToCloudinary(file, { skipCompression: true })`
  → stores the Cloudinary URL → FILE_UPLOAD-style uploaded UI (thumbnail + view
  + **Re-sign** which clears the pad and the stored URL).
- (c) **Required:** server `validateSubmission` treats a missing URL as missing
  (shared FILE_UPLOAD rule) → required empty blocks submit; optional empty is
  allowed. Verified by the 4 new API tests.
- (d) **Preview:** live interactive `<SignaturePad>` (draw + Clear), no Save,
  no upload.
- (e) **Reports:** local `QuestionType` union gained `SIGNATURE`; URL lands in
  the `text` report bucket and renders as a thumbnail via the existing
  `/^https?:\/\//` + `isImageUrl` path.
- (f) **Dashboard:** no change needed — `renderAnswerValue` renders `.png` URLs
  as thumbnails and exports the URL as text in CSV/Excel.
- (g) **Conditional visibility:** unchanged; SIGNATURE participates like any
  other type via the shared visibility loop.
- (h) **Compression:** SIGNATURE path never calls `maybeCompressImage`
  (Finding #1).
- (i) **Hooks:** QuestionField new hooks are unconditional (Finding #2) — lint
  shows no Rules-of-Hooks error there.

## Notes / deviations

- No FILE_UPLOAD parallel required special-casing beyond what design.md
  anticipated. `ResponseDashboardPage.tsx` has no local `QuestionType` union and
  needed no change.
- No Prisma/schema/API-route changes. The public `upload-signature` signing
  endpoint and `services/cloudinary.ts` are reused unchanged.
