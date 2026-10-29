# Qivo hardening batch: M1 upload enforcement, M2/M3 analytics, Multi-Entry cap, L1/L2 editor polish

Four local commits off `origin/main` land the hardening batch: server-side Cloudinary host + file-type enforcement for FILE_UPLOAD/SIGNATURE (M1, per the approved `m1-design.md`), range-scoped funnel completions plus a 5,000-row sampling disclosure banner (M2/M3), a 50-entry cap on MULTI_ENTRY answers mirrored across API and client (Multi-Entry), and editor polish (L1 dead Media button removed, L2 `window.location.reload` replaced with in-place refresh). The diff touches only the six intended files plus one task artifact — no Prisma migration, no schema change, and the four commits remain unpushed. Verification evidence is recorded in all four `FEAT-00N.json` files, each `status: "completed"`, with typecheck/test/build gates reported green.

Watch for: the recorded API test totals differ between features (FEAT-001 70, FEAT-002 75, FEAT-003 77) — **possible** inconsistency, but reconciled as sequential growth from the 64-test baseline (confirmed: this test file now holds 61 `it()` blocks, matching FEAT-003's final claim). No blocking concerns found.

**Verdict**: APPROVED

## High-level view

M1 is implemented verbatim against the approved design. The old `/^https?:\/\//` string check is gone, replaced by an exported pure `isAllowedUploadUrl` that parses with the `URL` constructor, pins the host to `res.cloudinary.com` via `.hostname` (so `res.cloudinary.com.evil.com` and the `@evil.com` userinfo trick are rejected), and applies a best-effort extension type check on top of the host floor. FILE_UPLOAD and SIGNATURE are now separate cases with the exact error messages from the design table, and all six required test cases are present.

M3 fixes the funnel completions undercount by adding a range-scoped `prisma.formResponse.count({ where: responseWhere })` and selecting it (via the exported `selectCompletions`) whenever no cross-question filter is active, falling back to the sampled count when a filter is active. M2 layers the disclosure on top: `sampled`/`sampleCap`/`sampledCount` are added to the report payload (derived by the exported `deriveSampled`), the web `FormReport` type is kept in strict parity, and a note using the existing `inline-banner` class renders only when sampled. The `+N more responses` text was left untouched.

The Multi-Entry cap is the literal `50` mirrored as a named const in both layers (no shared cross-package module exists), each carrying a cross-reference comment. The server rejects `length > 50` with `"too many entries"` before the per-entry loop; the client no-ops `addEntry` at the cap and swaps the "+ Add another" button for a muted "Maximum 50 entries" note.

L1 removes only the no-op Media button, leaving Question and Section intact. L2 extracts the load body into `reloadEditorData()` (which deliberately does not flip the initial `loading` flag, kept in the effect's `finally`) and calls it from both the load effect and `deleteSectionById`. `.env.example` is untouched and already documents all four expected vars.

<details>
<summary>Issues (1)</summary>

1. **API test-count drift across feature records (possible, non-blocking)** — FEAT-001/002/003 record 70/75/77 API tests respectively. This reads as sequential growth from the 64 baseline, not a contradiction, and the final file holds 61 `it()` blocks matching FEAT-003's claim. No action required; noted only so a future reader isn't alarmed by the differing numbers.

</details>

<details>
<summary>Details</summary>

### M1 — host floor via URL parser, type check on top

The combined `case "SIGNATURE": case "FILE_UPLOAD":` that accepted any `/^https?:\/\//` string is gone, split into two cases delegating to an exported `isAllowedUploadUrl(value, { kind, allowedTypes })`. The ordering matches the design's failure table exactly: string guard and `new URL()` parse failure both return `"expected a file URL"`, non-`https:` returns `"expected a file URL"`, `hostname ∉ {res.cloudinary.com}` returns `"file must be uploaded to this form"`. Because the host is matched on the parsed `.hostname`, the classic bypasses are closed — the test block asserts `res.cloudinary.com.evil.com`, `evil.com`, and `https://res.cloudinary.com@evil.com/…` (which parses to hostname `evil.com`) all reject, and that plain `http://res.cloudinary.com/…` is rejected at the protocol step before the host matters.

The extension is taken from the pathname's last segment only (`split("/").pop()` then `lastIndexOf(".")`), so a query like `?x=.pdf` cannot spoof the type. FILE_UPLOAD only restricts when a non-empty `allowedFileTypes` is configured, expanding allowed MIMEs through the pinned `MIME_EXTENSIONS` map (with `image/*` matching `upload.ts`'s `imageExts`); a known-but-disallowed ext returns `"file type not allowed"` and an extensionless URL passes via the documented fallback with the host check still enforced. SIGNATURE is its own branch constrained to `{png,jpg,jpeg}` with `"signature must be an image"` otherwise, and never consults `allowedFileTypes` — the test proves this by passing an ignored `["application/pdf"]`. `allowedFileTypes` is read defensively (`Array.isArray` then `typeof === "string"` filter). This is the single authoritative server-side submit gate, so the invariant "every stored upload answer is an https `res.cloudinary.com` URL" now holds. Server-side size is intentionally not enforced (no bytes reach the API) — a residual gap the design explicitly scopes out.

### M3 — range-scoped completions wired to the real filter flag

`getFormReport` gains a fourth count in its `Promise.all`, `rangeScopedTotal = prisma.formResponse.count({ where: responseWhere })`, reusing the existing `responseWhere` that already folds in the `submittedAt` range when `hasRange` — so the count is range-correct without a new where clause. `const completions = sampledResponses` becomes `selectCompletions(rangeScopedTotal, sampledResponses, filterApplied)`, which returns the true range-scoped total when no filter is active and the sampled count when one is. Confirmed `filterApplied = Boolean(filter)` and `sampledResponses = scopedResponses.length` are the pre-existing variables, so the branch is wired to the real cross-question filter flag and the real in-memory sample size, not a renamed shadow. `computeFunnel` and its filter-active null-suppression are untouched, and `sampledResponses` still drives the per-question aggregates. On a form with >5,000 in-range responses and no filter, completions now reflects the true count instead of clamping at the cap.

### M2 — sampling disclosure, payload-to-type parity

The return object gains `sampled`, `sampleCap` (= `REPORT_SAMPLE_CAP` = 5000), and `sampledCount` (= `sampledResponses`). `sampled` is derived by the exported `deriveSampled(rangeScopedTotal, responses.length, cap, filterApplied)`: no-filter compares the true total against the cap (`>`, so exactly 5000 is not flagged), filter-active detects saturation by the pre-filter page length hitting the cap — the correct signal, since the filter runs in memory over the already-capped page. The web `FormReport` type adds the three fields, keeping the cross-boundary typecheck honest (the gate catches drift). The banner renders only when `report.sampled`, reusing the existing `inline-banner` class with no new CSS, and reads "Showing analytics based on the most recent {sampleCap} responses of {totalResponses} total." The unrelated 20-item `+N more responses` text was not touched.

### Multi-Entry cap — mirrored constant, server rejects before the loop

`MAX_MULTI_ENTRY_COUNT = 50` is a module const in `form.service.ts` and a local const in the `PublicFormPage.tsx` MULTI_ENTRY branch, each with a comment pointing at the other — the correct pattern given there is no shared cross-package module. Server-side the `value.length > MAX_MULTI_ENTRY_COUNT` check returns `"too many entries"` immediately after the `isArray` guard and before the per-entry blank/length loop, so the existing per-item checks are unchanged. Tests assert 51 entries throw `INVALID_RESPONSE` and 50 is accepted. Client-side `addEntry` no-ops at the cap and the "+ Add another" button is replaced by a muted "Maximum 50 entries" note once `entries.length >= 50`; `updateEntry`/`removeEntry` and the per-entry inputs are untouched.

### L1 / L2 — editor polish with no collateral

L1 removed exactly the floating Media button whose `onClick` was the `/* Future: add image */` no-op; the Question and Section floating buttons remain. L2 extracted the load effect's fetch + setState body into `reloadEditorData()`, which sets form/questions/sections/settings/theme but leaves the initial `loading` flag to the effect's `finally` so an in-place refresh doesn't blank the editor. `deleteSectionById` now `await`s `reloadEditorData()` instead of `window.location.reload()`, preserving the min-one-section guard and `confirm()` prompt, so questions re-group without a full reload. An `eslint-disable-next-line react-hooks/exhaustive-deps` was added on the effect's dep array, matching the suppression pattern the findings cite in sibling pages; FEAT-004 records the file carries only its two pre-existing baseline lint errors and no new unused-var error from the removed button.

### Scope, migrations, and the verification gate

`git diff origin/main --stat` shows only the six intended source files plus `FEAT-004.json` changed — no Prisma schema or migration, consistent with "No Prisma migration expected." `git status` confirms the working tree has no uncommitted app changes and the branch is ahead of `origin/main` by exactly four commits (one per FEAT), unpushed, satisfying "local commits only." Each feature file records its gate green: API `tsc --noEmit` exit 0 and `pnpm test` (ending at 77 across 3 files), web `tsc -b --noEmit` exit 0, `pnpm build:web` success, and web `pnpm test` (57). The recorded per-feature API totals grow 70 → 75 → 77 across the sequential features, which reconciles with the 64 baseline rather than contradicting it; this file now holds 61 `it()` blocks, matching FEAT-003's final count.

Not re-run: per the review scope the full build/test suites were not re-executed. The one articulable doubt (the differing API test totals) was resolved by reading the test file directly rather than running a suite.

</details>

<details>
<summary>File map</summary>

- `apps/api/src/modules/forms/form.service.ts` — M1 consts + exported `isAllowedUploadUrl`, split FILE_UPLOAD/SIGNATURE cases, MULTI_ENTRY cap const + guard, exported `selectCompletions`/`deriveSampled`, `rangeScopedTotal` count, `sampled`/`sampleCap`/`sampledCount` payload fields.
- `apps/api/src/modules/forms/form.service.test.ts` — six M1 url-enforcement cases, two MULTI_ENTRY cap tests, `selectCompletions`/`deriveSampled` unit blocks.
- `apps/web/src/pages/FormReportsPage.tsx` — `FormReport` type extended, `inline-banner` sampling note.
- `apps/web/src/pages/PublicFormPage.tsx` — mirrored `MAX_MULTI_ENTRY_COUNT`, capped `addEntry`, "Maximum 50 entries" note.
- `apps/web/src/pages/FormEditorPage.tsx` — dead Media button removed, `reloadEditorData()` extracted, `deleteSectionById` in-place refresh.
- `.env.example` — unchanged (verified; all four vars already documented).

Full diff: `git diff origin/main`.

</details>
