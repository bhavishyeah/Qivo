# Qivo Hardening Batch — Implementation Plan

Monorepo at `c:\Qivo` (pnpm). Web = `apps/web` (React + Vite), API = `apps/api`
(Express + Prisma). No Prisma migration for any item. Local commits only — do
NOT push and do NOT open a PR.

Grounded in a read of: `.agents/tasks/session-features-audit.md`, the approved
M1 design at `.agents/tasks/qivo-hardening-batch/m1-design.md`, and the actual
source (`apps/api/src/modules/forms/form.service.ts`,
`apps/web/src/pages/{FormEditorPage,PublicFormPage,FormReportsPage}.tsx`,
`apps/api/src/modules/forms/form.service.test.ts`, `.env.example`, the three
package.json files).

## Design decisions recorded here (no separate design doc)

- **M1** follows the approved `m1-design.md` verbatim — do not re-decide it.
- **Multi-Entry cap value: 50.** No shared cross-package lib exists (`apps/web`
  and `apps/api` are separate packages with no imported shared module), so a
  single shared constant is not practical. Mirror the literal `50` as a named
  const in each layer with a comment pointing at the other, exactly as the task
  permits.
- **M3 range-scoped completions.** `getFormReport` already computes
  `totalResponses = prisma.formResponse.count({ where: { formId } })` but that
  count is NOT date-range scoped. For the no-filter completions fix we need a
  count scoped by the active date range, so add a dedicated range-scoped count
  using the existing `responseWhere` object (which already folds in the
  `submittedAt` range when `hasRange`). Reuse `responseWhere`; do not invent a
  new where clause.
- **M2 sampled flag scope.** `sampled` is true when the true in-scope response
  count (range + filter aware) exceeds `REPORT_SAMPLE_CAP` (5000) — i.e. when
  the in-memory aggregation actually dropped rows. Expose `sampleCap` (the cap)
  and `sampledCount` (rows actually aggregated) alongside the boolean so the web
  banner can say "most recent 5,000 of N".
- **Banner styling.** Reuse the existing `inline-banner` class already used for
  `refetchError` in `FormReportsPage.tsx` so the note matches dashboard styling
  with no new CSS.
- **L2 refresh.** Extract the fetch-and-setState body of the existing
  `loadEditor` effect into a reusable `reloadEditorData()` callback and call it
  from both the effect and `deleteSectionById`, replacing
  `window.location.reload()`.

## Build / test commands (discovered)

- API typecheck: `pnpm exec tsc --project tsconfig.json --noEmit` in `apps/api`
  (exit 0).
- API tests: `pnpm test` in `apps/api` (`vitest run`).
- Web typecheck: `pnpm exec tsc -b --noEmit` in `apps/web` (exit 0).
- Web build: `pnpm build:web` from repo root (runs `vite build` in `apps/web`),
  or `pnpm build` in `apps/web` (`tsc -b && vite build`).
- Web tests: `pnpm test` in `apps/web` (`vitest run`).

---

# Implementation Plan

- [ ] 1. (M1 — do first, security) Add server-side Cloudinary host + file-type
      enforcement for FILE_UPLOAD and SIGNATURE, implemented exactly per
      `m1-design.md`. In `apps/api/src/modules/forms/form.service.ts`, add
      module-level consts `CLOUDINARY_DELIVERY_HOSTS`
      (`new Set(["res.cloudinary.com"])`) and `MIME_EXTENSIONS` (the pinned
      MIME→ext map from the design), plus an **exported** pure helper
      `isAllowedUploadUrl(value, { kind: "file" | "signature", allowedTypes })`
      returning `string | null`. Rules per design: string guard →
      `new URL(value)` parse → `protocol === "https:"` → hostname ∈ allowed set
      (else `"file must be uploaded to this form"`); extension from pathname
      last segment only; FILE_UPLOAD with a non-empty `allowedFileTypes`
      rejects a known-but-disallowed ext with `"file type not allowed"`, accepts
      unknown ext; SIGNATURE requires ext ∈ {png,jpg,jpeg} else
      `"signature must be an image"`, accepts unknown ext, never consults
      `allowedFileTypes`. Split the combined `case "SIGNATURE": case
      "FILE_UPLOAD":` into two cases that delegate to the helper. Keep the
      existing `MAX_TEXT_LEN` guard at the top of
      `validateAnswerAgainstQuestion` untouched.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit`
      exits 0.

- [ ] 2. (M1 tests) Add a `describe("FILE_UPLOAD / SIGNATURE url enforcement", …)`
      block to `apps/api/src/modules/forms/form.service.test.ts`, importing the
      exported `isAllowedUploadUrl`. Cover the six required cases from the design:
      (a) valid `res.cloudinary.com` PDF with `allowedTypes` incl
      `application/pdf` → null; (b) non-Cloudinary host
      (`res.cloudinary.com.evil.com`, `evil.com`, and plain `http://…`) →
      `"file must be uploaded to this form"`; (c) disallowed ext (`.exe`, or
      `.pdf` when `allowedTypes = ["image/*"]`) → `"file type not allowed"`;
      (d) extensionless path with `allowedTypes = ["application/pdf"]` → null,
      and the same extensionless path on a non-Cloudinary host → still rejected;
      (e) SIGNATURE `.png` and `.jpg` with an (ignored) `allowedFileTypes` →
      null; (f) SIGNATURE `.pdf` → `"signature must be an image"`.
      Files: `apps/api/src/modules/forms/form.service.test.ts`
      Verify: `cd apps/api && pnpm test` — new block green, existing 64 tests
      still pass.

- [ ] 3. (M3 — server) In `getFormReport`
      (`apps/api/src/modules/forms/form.service.ts`), add a range-scoped true
      count to the existing `Promise.all` using `responseWhere`
      (`prisma.formResponse.count({ where: responseWhere })`), name it e.g.
      `rangeScopedTotal`. Replace `const completions = sampledResponses;` with:
      when NO cross-question filter is active
      (`!filterApplied`) use `rangeScopedTotal`; when a filter IS active keep
      `sampledResponses` (preserving today's behavior — the conversion % is
      already suppressed to null by `computeFunnel` when `filterActive`). Leave
      `computeFunnel` and the filter-active null-suppression untouched. Keep
      `sampledResponses` used for the per-question aggregates/`skipped`/avgTime
      exactly as-is.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit`
      exits 0.

- [ ] 4. (M2 — server payload) In the same `getFormReport` return object, add
      `sampled: boolean`, `sampleCap: number` (= `REPORT_SAMPLE_CAP`), and
      `sampledCount: number` (= `sampledResponses`). Compute `sampled` as "the
      true in-scope response count exceeds the cap" — i.e. `rangeScopedTotal >
      REPORT_SAMPLE_CAP` when no filter is active; when a filter is active,
      `sampled` is true iff the unfiltered `responses` array was itself capped
      (`responses.length === REPORT_SAMPLE_CAP`), because the filter runs over
      the already-capped in-memory sample.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit`
      exits 0.

- [ ] 5. (M2/M3 — server tests) Extend
      `apps/api/src/modules/forms/form.service.test.ts` with unit coverage for
      the two new server behaviors. Because `computeFunnel` is already exported
      and unit-tested, assert the completions-branch intent at that level
      (filter-active vs not) AND add a focused test asserting the `sampled`
      derivation given a known total vs cap — extract/export a tiny pure helper
      if that makes the branch testable without a DB (e.g. a
      `deriveSampled(total, cap, filterActive, capturedLen)` or test the
      completions selection via a small exported pure function). Keep it pure/no
      DB, matching how `computeFunnel`/`matchesAnswerFilter` are tested.
      Files: `apps/api/src/modules/forms/form.service.ts` (export the small
      helper if introduced), `apps/api/src/modules/forms/form.service.test.ts`
      Verify: `cd apps/api && pnpm test` — new tests green, all existing pass.

- [ ] 6. (M2 — web type + banner) In `apps/web/src/pages/FormReportsPage.tsx`,
      add `sampled: boolean; sampleCap: number; sampledCount: number;` to the
      `FormReport` type (keep it in sync with the server payload). When
      `report.sampled` is true, render a tasteful note using the existing
      `inline-banner` class (same pattern as `refetchError`), placed near the
      top of the loaded report (e.g. just before `<StatCards>`), reading like
      "Showing analytics based on the most recent 5,000 responses of N total"
      using `report.sampleCap.toLocaleString()` and
      `report.totalResponses.toLocaleString()`. Do NOT touch the existing
      "+ N more responses" text on the 20-item text sample (~L730).
      Files: `apps/web/src/pages/FormReportsPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0;
      `pnpm build:web` (from repo root) succeeds; `cd apps/web && pnpm test`
      green.

- [ ] 7. (Multi-Entry cap — server) In
      `apps/api/src/modules/forms/form.service.ts`, add a named module const
      `MAX_MULTI_ENTRY_COUNT = 50` with a comment that the web layer mirrors it
      in `PublicFormPage.tsx`. In `validateAnswerAgainstQuestion`'s
      `case "MULTI_ENTRY":` branch, after the `isArray` guard reject when
      `value.length > MAX_MULTI_ENTRY_COUNT` with a clear message (e.g.
      `"too many entries"`). Keep the existing per-entry blank/length checks
      unchanged.
      Files: `apps/api/src/modules/forms/form.service.ts`
      Verify: `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit`
      exits 0.

- [ ] 8. (Multi-Entry cap — server test) Add a unit test (via `validateSubmission`,
      matching the existing MULTI_ENTRY test style) asserting an answer with
      more than 50 entries is rejected (throws `INVALID_RESPONSE`), and that
      exactly 50 is accepted.
      Files: `apps/api/src/modules/forms/form.service.test.ts`
      Verify: `cd apps/api && pnpm test` — new test green, existing pass.

- [ ] 9. (Multi-Entry cap — client) In
      `apps/web/src/pages/PublicFormPage.tsx` MULTI_ENTRY branch, add a mirrored
      const `MAX_MULTI_ENTRY_COUNT = 50` (comment: mirrors API
      `form.service.ts`). Guard `addEntry` so it no-ops at the cap, and
      hide/disable the "+ Add another" button once `entries.length >=
      MAX_MULTI_ENTRY_COUNT`, showing a small muted note (e.g. "Maximum 50
      entries"). Keep the per-entry inputs and remove-entry behavior unchanged.
      Files: `apps/web/src/pages/PublicFormPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0;
      `pnpm build:web` succeeds.

- [ ] 10. (L1 — dead Media button) In
      `apps/web/src/pages/FormEditorPage.tsx` (~L1138-1146) remove the floating
      "🖼 Media" button whose `onClick` is the empty `/* Future: add image */`
      no-op. Remove any now-unused handler/markup so no dead code remains; leave
      the "＋ Question" and "§ Section" floating buttons intact.
      Files: `apps/web/src/pages/FormEditorPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0;
      `cd apps/web && pnpm lint` reports no new unused-var errors;
      `pnpm build:web` succeeds.

- [ ] 11. (L2 — in-place refresh after section delete) In
      `apps/web/src/pages/FormEditorPage.tsx`, extract the fetch + setState body
      of the `loadEditor` effect (~L177-200) into a reusable
      `reloadEditorData()` function (sets form/questions/sections/settings
      state; does not flip the initial `loading` flag). Call it from the load
      effect and, in `deleteSectionById` (~L543), replace
      `window.location.reload()` with `await reloadEditorData()` so questions
      re-group without a full reload or lost editor state.
      Files: `apps/web/src/pages/FormEditorPage.tsx`
      Verify: `cd apps/web && pnpm exec tsc -b --noEmit` exits 0;
      `pnpm build:web` succeeds; `cd apps/web && pnpm test` green.

- [ ] 12. (.env.example verify — likely no-op) Confirm `.env.example` already
      documents `RESPONSE_EDIT_SECRET` (with the "SET A RANDOM VALUE IN
      PRODUCTION" note) and `WEB_URL`/`EMAIL_FROM`/`RESEND_API_KEY`. Confirmed
      present on read — the audit is accurate. Only edit if a genuinely new,
      undocumented `process.env` read was introduced by items 1–11 (none is
      expected; M1 reads no new env var). Do not churn the file otherwise.
      Files: `c:\Qivo\.env.example` (only if something is actually missing)
      Verify: no new `process.env.*` identifier introduced in the diff lacks a
      matching documented key in `.env.example`.

- [ ] 13. (Full verification gate) Run all four gates and confirm green:
      `cd apps/api && pnpm exec tsc --project tsconfig.json --noEmit` (exit 0)
      and `pnpm test` (incl. new M1/M3/Multi-Entry tests);
      `cd apps/web && pnpm exec tsc -b --noEmit` (exit 0), `pnpm build:web`
      succeeds, `cd apps/web && pnpm test` green. Fix any failure before
      finishing. Commit locally only — no push, no PR.
      Files: none (verification only)
      Verify: all four commands succeed as above.

## Notes / gaps

- No README/AGENTS.md/CONTRIBUTING/`.kiro/steering` files exist in the repo; the
  package.json scripts are the authoritative command source.
- Server-side file **size** enforcement is explicitly out of scope per
  `m1-design.md` (the API never receives the bytes).
