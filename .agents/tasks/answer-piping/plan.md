# Implementation Plan — Answer Piping (labels only)

Source of truth: `.agents/tasks/answer-piping/design.md` (approved). This plan sequences that design faithfully; it does not re-decide the architecture. Scope is **labels only**, a pure display-time transform, **no backend change**.

## Context discovered during exploration (read before starting)

- Monorepo, pnpm workspaces. Web app is `apps/web` (TypeScript + React 19 + Vite). No new deps are needed.
- **No test runner is configured** in `apps/web` (no `test` script, no vitest/jest in `package.json`). Step 1 below adds a minimal vitest setup scoped to the pure resolver, because the resolver is pure and is the highest-value thing to test. If that setup proves to destabilize the green build, it is isolated to its own step and the remaining steps still verify via typecheck + lint + build (see the note in step 1).
- Real commands, all run from `apps/web` (confirmed working on the current green baseline):
  - Typecheck: `pnpm exec tsc -b --noEmit` (exit 0 today).
  - Lint: `pnpm exec eslint <path>` (exit 0 today).
  - Build: `pnpm exec vite build`.
- `tsconfig.app.json` uses `verbatimModuleSyntax: true` (type-only imports MUST use `import type`), `noUnusedLocals`/`noUnusedParameters: true`, and `include: ["src"]` (so any file under `src` is typechecked by `tsc -b`).
- Confirmed targets exist and match the design:
  - `apps/web/src/lib/conditions.ts` — `evaluateConditions`, the value-handling precedent (array via `Array.isArray`, scalar via `String(answer ?? "")`).
  - `apps/web/src/types/index.ts` — `AnswerValue = string | number | string[] | boolean | null`, `Question`, `QuestionOption`, `QuestionType` (includes `MULTI_ENTRY`, `YES_NO`, `LINEAR_SCALE`, etc.).
  - `apps/web/src/pages/PublicFormPage.tsx` — `allQuestions = sections.flatMap(s => s.questions)` already in scope; `QuestionField` renders `question.label` inside `<span className="question-label">`; `answers` state re-renders on every keystroke; RATING and LINEAR_SCALE fieldsets use `aria-label={question.label}`. The exact emptiness test for "unanswered" lives in `validateSection`/`validateAll` (array → `length === 0 || every(e => !e.trim())`; scalar → `undefined || null || ""`).
  - `apps/web/src/pages/FormPreviewPage.tsx` — `PreviewQuestion` renders `question.label` the same way; it currently flattens only the **current** section's visible questions (`questions` useMemo), so a form-wide `allQuestions` must be added. Note: the preview's RATING/LINEAR_SCALE fieldsets do **not** use `aria-label` (no `role="radiogroup"`), so there is no aria-label to update there.
  - `apps/web/src/pages/FormEditorPage.tsx` — active `QuestionCard` receives `allQuestions` and `index`; the label `<input>` is bound to `question.label` via `onChange(question.id, { label: ... })`; `ConditionEditor` defines the earlier-questions-only filter `allQuestions.filter(q => q.id !== question.id && allQuestions.indexOf(q) < allQuestions.indexOf(question))` and disables its "+ Add condition" button with `title="Add questions above first"` when empty.
- Backend confirmed display-agnostic (no change): `apps/api/src/modules/forms/form.service.ts` stores `label: input.label.trim()` verbatim; required-check and `validateAnswerAgainstQuestion` key off `question.id`; label text is only re-rendered raw in the confirmation email summary (`apps/api/src/services/email.ts` ~L316) and analytics `QuestionReport.label` (~L2304) — both acceptable raw-token spots per the design, out of scope for v1.

---

- [ ] 1. Add a minimal Vitest setup for pure-lib unit tests in `apps/web`.
      Add `vitest` as a devDependency, add a `"test": "vitest run"` script, and create `apps/web/vitest.config.ts` (reuse the existing `defineConfig`/react plugin pattern is not needed — a plain `test: { include: ["src/**/*.test.ts"], environment: "node" }` config is enough since the resolver is DOM-free). Ensure `tsc -b` stays green: `*.test.ts` files live under `src` so they are typechecked — import vitest APIs explicitly (`import { describe, it, expect } from "vitest"`) rather than relying on globals, to avoid needing a `types` change. Do NOT add any test file in this step; just the tooling.
      Files: `apps/web/package.json`, `apps/web/vitest.config.ts`
      Verify: from `apps/web`, run `pnpm install` then `pnpm exec vitest run` — it runs and reports "no test files found" (or 0 tests) with exit 0; `pnpm exec tsc -b --noEmit` still exits 0.
      Fallback: if adding vitest destabilizes `tsc -b` or `vite build` in a way that cannot be quickly resolved, revert this step and the `piping.test.ts` from step 7; the resolver is then verified by typecheck + lint + build only. Record that decision in the step output.

- [ ] 2. Create the piping resolver library `apps/web/src/lib/piping.ts`.
      Export `PIPING_TOKEN_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g` and `resolvePipedLabel(label: string, questions: Question[], answers: Record<string, AnswerValue>): string`. Use `import type { AnswerValue, Question } from "../types"` (verbatimModuleSyntax). Build a `Map<string, Question>` from `questions` once per call. Implement via `label.replace(PIPING_TOKEN_RE, (_match, id) => resolveToken(id))` where `resolveToken(id)`:
      1) `q = byId.get(id)`; if missing → return `""` (unknown id).
      2) `value = answers[id]`.
      3) "unanswered" when `value` is `undefined`/`null`/`""`/empty array/array whose entries are all blank after `.trim()` — mirror PublicFormPage's `validateSection` test exactly.
      4) unanswered + `q.required` → return the fallback string `` `[answer "${q.label.trim()}" first]` `` (do NOT recursively resolve the referenced label); unanswered + optional → return `""`.
      5) answered → return `renderAnswerValue(q, value)`.
      Add internal `renderAnswerValue(question, value)` per design decision 3: plain string as-is; `number` → `String(value)`; `string[]` → map through choice value→label for `MULTIPLE_CHOICE` (else raw entry), skip blank/whitespace-only entries, join with `", "`; `SINGLE_CHOICE` → `options.find(o => o.value === value)?.label ?? String(value)`; `YES_NO` → built-in `{ yes: "Yes", no: "No" }` map falling back to raw; every other type → `String(value)`. Keep it a pure function with no React import.
      Files: `apps/web/src/lib/piping.ts`
      Verify: from `apps/web`, `pnpm exec tsc -b --noEmit` exits 0 and `pnpm exec eslint src/lib/piping.ts` exits 0.

- [ ] 3. Wire resolved labels into `PublicFormPage.tsx` (respondent renderer).
      Import `resolvePipedLabel` from `../lib/piping`. Pass two new props to `QuestionField` at its call site — `allQuestions={allQuestions}` and `answers={answers}` — and add them to the `QuestionField` prop type. Inside `QuestionField`, compute `const resolvedLabel = resolvePipedLabel(question.label, allQuestions, answers);` and render `{resolvedLabel}` in place of `{question.label}` inside the `<span className="question-label">`. Replace the two `aria-label={question.label}` usages (RATING and LINEAR_SCALE `role="radiogroup"` fieldsets) with `aria-label={resolvedLabel}`. Leave the MULTI_ENTRY per-entry `aria-label={\`${question.label} — entry ${idx + 1}\`}` as-is (entry-index labels, out of scope and fine raw). No new state/effects — re-render on `answers` change already happens.
      Files: `apps/web/src/pages/PublicFormPage.tsx`
      Verify: from `apps/web`, `pnpm exec tsc -b --noEmit` exits 0 and `pnpm exec eslint src/pages/PublicFormPage.tsx` exits 0.

- [ ] 4. Wire resolved labels into `FormPreviewPage.tsx` (preview parity).
      Import `resolvePipedLabel` from `../lib/piping`. Add a form-wide flattened list `const allQuestions = useMemo(() => sections.flatMap(s => s.questions), [sections]);` (distinct from the existing current-section `questions` useMemo — do not remove that one). Pass `allQuestions={allQuestions}` and `answers={answers}` into `PreviewQuestion` and add them to its prop type. Inside `PreviewQuestion`, compute `const resolvedLabel = resolvePipedLabel(question.label, allQuestions, answers);` and render `{resolvedLabel}` in the `<span className="question-label">`. (No `aria-label` on preview rating/scale fieldsets, so nothing else to update.) This keeps preview output consistent with the public form, including fallback copy and choice-label resolution.
      Files: `apps/web/src/pages/FormPreviewPage.tsx`
      Verify: from `apps/web`, `pnpm exec tsc -b --noEmit` exits 0 and `pnpm exec eslint src/pages/FormPreviewPage.tsx` exits 0.

- [ ] 5. Add the editor "Insert answer reference" affordance in `FormEditorPage.tsx` (active `QuestionCard`).
      Directly beneath the "Question label" `<input>` (the one bound to `question.label`), add a small `<select>` control reusing the exact earlier-questions filter from `ConditionEditor`: `const availableQuestions = allQuestions.filter(q => q.id !== question.id && allQuestions.indexOf(q) < allQuestions.indexOf(question));`. The `<select>` has a disabled, selected placeholder option "Insert answer reference" plus one `<option value={q.id}>` per earlier question showing `q.label.slice(0, 30)`. On change call `insertReference(id)` which appends a token: `const sep = question.label && !question.label.endsWith(" ") ? " " : ""; onChange(question.id, { label: \`${question.label}${sep}{{${id}}}\` });` then reset the `<select>` back to the placeholder (controlled value reset to `""`). Disable the `<select>` when `availableQuestions.length === 0` with `title="Add questions above first"`, mirroring `ConditionEditor`'s "+ Add condition" disable. Add `e.stopPropagation()` on click to match the sibling inputs' pattern (prevents the card drag/activate handlers from firing).
      Files: `apps/web/src/pages/FormEditorPage.tsx`
      Verify: from `apps/web`, `pnpm exec tsc -b --noEmit` exits 0 and `pnpm exec eslint src/pages/FormEditorPage.tsx` exits 0.

- [ ] 6. Add the editor raw-token preview helper line in `FormEditorPage.tsx` (active `QuestionCard`).
      Add a tiny editor-only helper (define it near `QuestionCard`, NOT in `piping.ts` — it needs no live answers) that replaces each `{{id}}` in the raw label with `[<referenced question label>]`, or `[unknown reference]` when the id isn't in `allQuestions`. Reuse `PIPING_TOKEN_RE` imported from `../lib/piping` for matching (import it; keeps one regex source). Below the label `<input>` (and below the insert `<select>` from step 5), when the raw `question.label` matches `PIPING_TOKEN_RE` at least once, render a single muted helper line, e.g. `Preview: Confirm [Team captain name]'s jersey size`, styled like the existing muted helper text (reuse an existing muted class/inline style used elsewhere in the card). The label `<input>` itself keeps showing raw tokens (no two-way transform). Do not change the inactive-card listing (`question.label || "Untitled question"`).
      Note: `PIPING_TOKEN_RE` is a module-level `/g` regex — when testing a label with `.test()`/`.exec()`, reset `lastIndex` (or use `label.match(PIPING_TOKEN_RE)`) to avoid stateful-regex bugs across renders.
      Files: `apps/web/src/pages/FormEditorPage.tsx`
      Verify: from `apps/web`, `pnpm exec tsc -b --noEmit` exits 0 and `pnpm exec eslint src/pages/FormEditorPage.tsx` exits 0.

- [ ] 7. Add unit tests for the resolver in `apps/web/src/lib/piping.test.ts`.
      Import `{ describe, it, expect } from "vitest"` and `{ resolvePipedLabel } from "./piping"` and `type { Question } from "../types"`. Cover, per the design's Testability section: single token resolves; multiple tokens in one label; unknown id → `""`; malformed/partial braces (`{{`, `{{}}`, `{{ foo-bar }}`) passed through verbatim; required-unanswered → exact fallback `[answer "<label>" first]`; optional-unanswered → `""`; plain string; number → stringified; `string[]`/`MULTI_ENTRY` join with blank entries skipped; `SINGLE_CHOICE` value→label; `MULTIPLE_CHOICE` values→labels joined; `YES_NO` → `Yes`/`No`; option-deleted → raw value fallback. Build minimal `Question` fixtures inline.
      Files: `apps/web/src/lib/piping.test.ts`
      Verify: from `apps/web`, `pnpm exec vitest run` — all new tests pass; `pnpm exec tsc -b --noEmit` still exits 0.
      (If step 1's fallback was taken, skip this step.)

- [ ] 8. Full-project verification.
      Run the web build and the repo typecheck to confirm nothing regressed across all four touched files plus the new lib.
      Files: none (verification only).
      Verify: from `apps/web`, `pnpm exec vite build` succeeds; from repo root, `pnpm typecheck` exits 0; from `apps/web`, `pnpm exec eslint src/lib/piping.ts src/pages/PublicFormPage.tsx src/pages/FormPreviewPage.tsx src/pages/FormEditorPage.tsx` exits 0; and if vitest was set up, `pnpm --filter web test` (or from `apps/web`, `pnpm exec vitest run`) passes.

## Notes / assumptions

- `AnswerValue` can be `boolean | null`; the resolver's `renderAnswerValue` falls through to `String(value)` for a stray boolean, which is harmless (no question type stores a bare boolean as an answer today — `YES_NO` stores `"yes"`/`"no"` strings). No special-casing needed.
- The editor only ever inserts earlier-question tokens, so forward/self references cannot be authored through the UI; a hand-crafted forward reference still degrades gracefully (blank/fallback) via the runtime resolver. No guard added.
- No backend files are modified. The raw-token appearance in the confirmation email and analytics labels is a known, accepted v1 limitation per the design.
