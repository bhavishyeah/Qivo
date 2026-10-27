# Implementation Plan — SIGNATURE question type

Source of truth: `.agents/tasks/signature-field/design.md` (ratified) plus the 5 findings in
`design-verdict.json` (2 MEDIUM + 3 NIT, all REQUIRED). This plan sequences the build
file-by-file. SIGNATURE mirrors FILE_UPLOAD at every layer except the capture widget; the
stored answer is an `https://…` Cloudinary URL, identical in shape to FILE_UPLOAD.

Build/test commands discovered during exploration (pnpm monorepo, no root AGENTS/CONTRIBUTING/steering):
- API unit tests: `cd apps/api && pnpm test` (vitest, `environment: "node"`, includes `src/**/*.test.ts`).
- Web unit tests: `cd apps/web && pnpm test` (vitest, `environment: "node"`, includes `src/**/*.test.{ts,tsx}`; existing component tests render via `react-dom/server`, there is NO jsdom/canvas env).
- Web build: `cd apps/web && pnpm build` (`tsc -b && vite build`).
- API typecheck/build: `cd apps/api && pnpm exec tsc --noEmit` (or `pnpm build`).
- Web lint: `cd apps/web && pnpm lint` (eslint, includes `eslint-plugin-react-hooks` — Rules-of-Hooks is enforced, see finding #2).

Ordering rationale: types/enums first (they unblock every consumer and keep TS compiling),
then the standalone component, then the consumers that import it, then the editor wiring,
then tests. Each step leaves the repo buildable.

---

- [ ] 1. Add `"SIGNATURE"` to the web `QuestionType` union.
      The union gates every web consumer's exhaustiveness; adding it first lets later steps compile.
      Files: apps/web/src/types/index.ts (the `QuestionType` union — append `| "SIGNATURE"` after `"MULTI_ENTRY"`). `AnswerValue` is unchanged (a URL string already fits `string`).
      Verify: `cd apps/web && pnpm exec tsc --noEmit` — no new type errors (switch/record consumers may now flag missing SIGNATURE; those are fixed in steps 7–9, so expect this step to surface them, not resolve them).

- [ ] 2. Add `"SIGNATURE"` to the API request-validation enum.
      So a question can be created/updated with `type: "SIGNATURE"` without a 400.
      Files: apps/api/src/modules/forms/form.schemas.ts — add `"SIGNATURE"` to the `questionTypeSchema` `z.enum([...])` array (next to `"FILE_UPLOAD"`).
      Verify: `cd apps/api && pnpm test` — existing `form.schemas.test.ts` still passes.

- [ ] 3. Add SIGNATURE to the API service: local union, answer validation, and report bucket.
      Three edits in one file, all mirroring FILE_UPLOAD. (a) In the local `export type QuestionType` union (top of file ~line 25) add `| "SIGNATURE"`. (b) In `validateAnswerAgainstQuestion` (~line 1272), stack `case "SIGNATURE":` directly ABOVE `case "FILE_UPLOAD":` (~line 1355) so SIGNATURE falls through into the existing https-URL check (`if (!isString || !/^https?:\/\//.test(value)) return "expected a file URL"`). ONE rule, one error string — no copy. (c) `getFormReport` (~line 2526) needs NO change for SIGNATURE: it matches none of the choice/rating/number/MULTI_ENTRY branches and lands in the final `text` bucket (`sample = answers.slice(0,20).map(String)`) exactly like FILE_UPLOAD — its URL renders as a thumbnail downstream. The required-check in `validateSubmission` (~line 1454) also needs NO change: a URL answer is non-empty (`value === "" | null | undefined` is the only "missing" test), so SIGNATURE is "present" when a URL exists — no special-casing (unlike MULTI_ENTRY). Because `validateSubmission` is called by both submit (~line 1855) and edit-response (~line 2153), SIGNATURE validation + required-enforcement cover the response-editing window for free.
      Files: apps/api/src/modules/forms/form.service.ts
      Verify: `cd apps/api && pnpm test` — all tests pass (new SIGNATURE assertions are added in step 10); `pnpm exec tsc --noEmit` clean.

- [ ] 4. Add the `signature_pad` dependency and confirm the build resolves it.
      Confirmed during exploration: `pnpm view signature_pad version` → `5.1.4` (current `latest` and latest v5). Add `"signature_pad": "5.1.4"` (exact, no caret) to `apps/web/package.json` dependencies, then `pnpm install`. If 5.1.4 is somehow unavailable, pin the nearest resolvable v5 (still exact) and note it in the PR. Before writing step 5, confirm the installed v5 API against `node_modules/signature_pad` types/README: default export `SignaturePad`; instance `isEmpty()`, `clear()`; the event-subscription API (see finding #5 — pick the MATCHED pair the installed types expose: `addEventListener`/`removeEventListener` OR `on`/`off`); the `beginStroke`/`endStroke` events; and the `backgroundColor` constructor option.
      Files: apps/web/package.json, pnpm-lock.yaml
      Verify: `cd apps/web && pnpm install` resolves cleanly; `pnpm build` succeeds (import resolves even before the component imports it anywhere — this is the dependency-resolution gate).

- [ ] 5. Create the reusable `SignaturePad` component.
      A `forwardRef` component owning its own `<canvas>` + Clear button, upload-agnostic (parent owns upload). Expose via `useImperativeHandle` a `SignaturePadHandle` with `isEmpty(): boolean`, `clear(): void`, `toPngFile(): Promise<File | null>` (empty or `toBlob` null → resolve `null`; else a `File([blob], "signature.png", { type: "image/png" })`). Props: `onChange?(isEmpty: boolean)`, `disabled?` (default false), `height?` (default 200), `ariaLabel?`. Construct `new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)" })` so the exported PNG is opaque white. High-DPI: on mount and on a debounced `window` resize, set `canvas.width/height = cssBox * devicePixelRatio`, `ctx.scale(dpr, dpr)`, then call `pad.clear()` (restores the white fill AND clears — keep the resize rule and white-fill rule as the same call). Export via `canvas.toBlob(cb, "image/png")` on the pad's own DPR-scaled canvas, NOT `toDataURL()`. `onChange` fires on every `beginStroke`/`endStroke` and after `clear`, each call passing `pad.isEmpty()` (idempotent, no first-stroke tracking). **Finding #4 (NIT):** border is `2px dashed #cbd5e1` ALWAYS — do not switch to solid on draw. **Finding #5 (NIT):** wire events with a MATCHED pair confirmed in step 4 (subscribe + unsubscribe from the same API family); do NOT mix `addEventListener` with `off()`. **Disable contract:** `disabled` is enforced ONLY via a wrapper style (`pointerEvents: disabled ? "none" : "auto"`, `opacity: disabled ? 0.6 : 1`), never via library enable/disable calls. Reserve `pad.off()` (if that is the chosen teardown API) STRICTLY for the unmount cleanup, alongside removing the resize listener.
      Files: apps/web/src/components/SignaturePad.tsx (new)
      Verify: `cd apps/web && pnpm exec tsc --noEmit` clean; `pnpm build` succeeds; `pnpm lint` reports no react-hooks violations in the new file.

- [ ] 6. Add the SIGNATURE branch to the public form's `QuestionField`.
      In `apps/web/src/pages/PublicFormPage.tsx` `QuestionField` (~line 598): the upload-state hooks (`uploading`, `uploadError`, `uploadProgress`) and the `uploadFileToCloudinary(file)` wrapper (which already calls `onChange(question.id, secureUrl)`, drives progress, and sets `uploadError`) already exist and are reused unchanged. **Finding #2 (MEDIUM — Rules of Hooks):** declare the NEW state as UNCONDITIONAL hooks at the TOP of `QuestionField`, alongside the existing upload hooks (NOT inside the branch): `const sigRef = useRef<SignaturePadHandle>(null)` and `const [sigEmpty, setSigEmpty] = useState(true)`. Add a `if (question.type === "SIGNATURE") { ... }` branch (place it adjacent to the FILE_UPLOAD branch ~line 814). In the branch: derive `const uploadedUrl = typeof value === "string" && value.startsWith("http") ? value : ""` (exactly as FILE_UPLOAD). Render `<SignaturePad ref={sigRef} disabled={uploading} onChange={(empty) => setSigEmpty(empty)} />`, a "Save signature" button disabled when `sigEmpty || uploading`, whose handler does `const file = await sigRef.current?.toPngFile(); if (file) await uploadFileToCloudinary(file);`. When `uploadedUrl` is set, reuse FILE_UPLOAD's uploaded-state UI (thumbnail via `isImageUrl(url)` — true for `.png` — a "✓ Signature saved · view" link, and a "Re-sign" affordance that does `sigRef.current?.clear()` and `onChange(question.id, null)`). Keep the `uploading` progress bar and inline `uploadError` as FILE_UPLOAD renders them. **Finding #1 (MEDIUM — compression):** `uploadFileToCloudinary` → `uploadToCloudinary` currently calls `maybeCompressImage`, which re-encodes a canvas wider than 1600px to JPEG and renames `.png`→`.jpg`. The signature PNG must stay a crisp PNG, so this path must NOT run `maybeCompressImage` for signatures. PREFERRED fix: bypass compression on the signature upload (see step 6a) rather than clamping; do not rely on the "tiny PNG is a no-op" assumption, which fails on wide/high-DPI viewports.
      Files: apps/web/src/pages/PublicFormPage.tsx
      Verify: `cd apps/web && pnpm exec tsc --noEmit` clean; `pnpm lint` passes (confirms the new hooks are unconditional and ordered); `pnpm build` succeeds.

- [ ] 6a. Make the signature upload bypass `maybeCompressImage` (Finding #1, MEDIUM).
      `uploadToCloudinary(slug, rawFile, onProgress)` in `apps/web/src/lib/upload.ts` unconditionally runs `maybeCompressImage(rawFile)`. Add an opt-out so signatures skip it while FILE_UPLOAD is unchanged. Recommended: add an options param, e.g. `uploadToCloudinary(slug, rawFile, onProgress, opts?: { skipCompression?: boolean })`, and when `skipCompression` is set, use `rawFile` directly instead of `await maybeCompressImage(rawFile)`. Then thread the flag through `QuestionField`'s `uploadFileToCloudinary` wrapper so ONLY the SIGNATURE Save handler passes it (FILE_UPLOAD keeps compressing). Keep the signature as `image/png` so `resourceType` stays `"image"` and the delivered URL ends `.png` (thumbnail-renderable). Do not change the XHR/signature-endpoint logic.
      Files: apps/web/src/lib/upload.ts, apps/web/src/pages/PublicFormPage.tsx
      Verify: `cd apps/web && pnpm exec tsc --noEmit` clean; `pnpm build` succeeds; manual/trace confirmation that the SIGNATURE path never calls `maybeCompressImage` while FILE_UPLOAD still does. (If a test harness exists, a unit test on `uploadToCloudinary` with `skipCompression: true` asserting the file is sent unmodified is worth adding — see step 10 note.)

- [ ] 7. Add the SIGNATURE branch to the preview page (live canvas, NO upload).
      In `apps/web/src/pages/FormPreviewPage.tsx`, add a `if (question.type === "SIGNATURE")` branch next to the FILE_UPLOAD branch (~line 343). Mount the SAME `<SignaturePad />` component so the respondent can draw + Clear, but render NO "Save signature" button and NO upload (preview submissions are never persisted). No ref needed. Keep label/description rendering consistent with the surrounding branches.
      Files: apps/web/src/pages/FormPreviewPage.tsx
      Verify: `cd apps/web && pnpm exec tsc --noEmit` clean; `pnpm build` succeeds.

- [ ] 8. Wire SIGNATURE into the Form Editor.
      In `apps/web/src/pages/FormEditorPage.tsx`: (a) add `SIGNATURE: "Signature"` to `QUESTION_TYPE_LABELS` (~line 42) — this also makes it appear in BOTH type `<select>`s, which map over `Object.keys(QUESTION_TYPE_LABELS)` (~line 953 and ~line 1482). (b) **Finding #3 (NIT — accurate refs):** the FILE_UPLOAD settings panel is gated on `question.type === "FILE_UPLOAD"` at ~line 1666, so it already does NOT render for SIGNATURE — no change needed there except confirming it. (c) The type-change handler at ~line 1448 resets options for choice types and seeds settings for rating/scale types; SIGNATURE needs no default settings. Leftover `maxFileSizeMB`/`allowedFileTypes` from a FILE_UPLOAD→SIGNATURE switch are inert (SIGNATURE reads no settings), so a reset is OPTIONAL; for tidiness you MAY add `if (newType === "SIGNATURE") patch.settings = undefined;`. The new-question default-settings block (~line 459) needs no SIGNATURE case (no defaults). (d) Add a SIGNATURE static editor preview block (gated on `question.type === "SIGNATURE"`, placed near the MULTI_ENTRY preview block ~line 1723): a simple bordered box (`2px dashed #cbd5e1`, matching the drop-zone aesthetic) labeled "Signature" with a muted "Respondent signs here" hint. No live canvas in the editor.
      Files: apps/web/src/pages/FormEditorPage.tsx
      Verify: `cd apps/web && pnpm exec tsc --noEmit` clean (the `Record<QuestionType, string>` label map now requires the SIGNATURE key, confirming completeness); `pnpm build` succeeds.

- [ ] 9. Keep the Reports page local union in sync.
      `apps/web/src/pages/FormReportsPage.tsx` has its OWN local `QuestionType` union (~line 53) — add `"SIGNATURE"` to it. No render change: signature URLs arrive in the `text`-kind report and `renderSampleAnswer` already renders `/^https?:\/\//` + `isImageUrl` URLs as thumbnails. `ResponseDashboardPage.tsx` needs NO change: `renderAnswerValue` already renders `.png` URLs as thumbnails and exports the URL as text in CSV/Excel.
      Files: apps/web/src/pages/FormReportsPage.tsx
      Verify: `cd apps/web && pnpm exec tsc --noEmit` clean; `pnpm build` succeeds.

- [ ] 10. Add server-side unit tests for SIGNATURE validation.
      In `apps/api/src/modules/forms/form.service.test.ts` (tests `validateSubmission`, which runs `validateAnswerAgainstQuestion`), add cases using the existing `schemaWith([...])` helper: (a) a SIGNATURE question with a valid `https://…/signature.png` URL passes; (b) a SIGNATURE answer that is a non-URL string (e.g. `"not-a-url"`) throws `INVALID_RESPONSE` with the "expected a file URL" message; (c) a required SIGNATURE with no answer throws (required-check parity with FILE_UPLOAD); (d) an optional SIGNATURE left blank passes. This is the highest-value test and the one with zero setup friction — it locks the server invariant (the only untrusted-input gate).
      Files: apps/api/src/modules/forms/form.service.test.ts
      Verify: `cd apps/api && pnpm test` — all tests pass, including the 4 new SIGNATURE cases.

- [ ] 11. Final full-build + lint gate.
      Run the whole verification suite to confirm the feature integrates and nothing regressed.
      Files: (none — verification only)
      Verify: `cd apps/api && pnpm test && pnpm exec tsc --noEmit` all green; `cd apps/web && pnpm test && pnpm lint && pnpm build` all green.

---

## Notes, assumptions, and gaps

- **Web unit test for `SignaturePad` is intentionally NOT a required step.** The web vitest env is `environment: "node"` with no jsdom/canvas; existing web tests render to static markup via `react-dom/server`. A meaningful `SignaturePad` test needs a DOM + canvas (jsdom + canvas stub or a `signature_pad` seam), which is env setup beyond this feature's scope. The design's own "Testability" section acknowledges jsdom canvas limits. RECOMMENDATION: rely on the server-side validation tests (step 10) plus the manual integration checklist below. If the coder chooses to add a `SignaturePad` test, it must first add a jsdom environment (e.g. per-file `// @vitest-environment jsdom` + `jsdom` devDep) or stub the `signature_pad` instance via a thin injection seam, and assert wiring (events → `onChange`, `toPngFile()` returns a `File` with `type: "image/png"` when drawn and `null` when empty) rather than pixel output. Treat this as optional.
- **`maybeCompressImage` is a pure helper worth a unit test** if the step-6a opt-out is added: a test asserting `uploadToCloudinary(..., { skipCompression: true })` sends the original `File` untouched would guard Finding #1 against regressions. Same jsdom/canvas caveat applies to exercising `maybeCompressImage` directly (it uses `createImageBitmap`/`canvas`), so prefer asserting the branch decision over pixel behavior.
- **Finding #1 decision recorded:** bypass `maybeCompressImage` for signatures (step 6a) was chosen over clamping the canvas to ≤1600px, per the verdict's stated preference — the signature is small line art and must stay a crisp PNG.
- **Branch placement is adjacency, not exact line numbers.** Line numbers above (~814, ~1666, ~1448, ~1723, ~459) are current references for orientation; the coder should anchor on the named code (the FILE_UPLOAD branch, the `QUESTION_TYPE_LABELS` map, the type-change handler, the MULTI_ENTRY preview block) rather than the literal line.
- **No Prisma/schema/API-route changes.** Answers persist in the existing `FormResponse.answers` JSON; the public `POST /api/forms/public/:slug/upload-signature` signing endpoint and `services/cloudinary.ts` are reused unchanged.
- **`do not push`** — per the original user request ("I will tell you when to push it"), commit locally only; do not push or open a PR.
