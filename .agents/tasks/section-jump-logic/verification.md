# Verification — Per-section jump logic (skip logic)

First iteration (no `review.json` present). Implemented from the approved plan
and design. No Prisma migration — jump rules ride the JSON `Form.schema`.

## Commands run and results

All commands run on Windows / PowerShell at the repo root `c:\Qivo`.

### Web (`c:\Qivo\apps\web`)

| Command | Result |
| --- | --- |
| `pnpm exec tsc -b --noEmit` | exit 0 (no errors) |
| `pnpm build` (`tsc -b && vite build`) | success — `✓ built in 4.75s`, 639 modules transformed. The only output warning is the pre-existing chunk-size-over-500kB advisory, unrelated to this change. |
| `pnpm test` (vitest run) | 4 files passed, **43 tests passed** (includes the new `src/lib/sectionJumps.test.ts` with 14 tests). |

### API (`c:\Qivo\apps\api`)

| Command | Result |
| --- | --- |
| `pnpm exec tsc --project tsconfig.json --noEmit` | exit 0 (no errors) |
| `pnpm test` (vitest run) | 3 files passed, **33 tests passed** (includes the extended `form.service.test.ts`: reach-aware required-check suite + server jump-helper suite; the 8 pre-existing `validateSubmission` cases still pass unchanged). |

## What was tested

### Web unit tests — `apps/web/src/lib/sectionJumps.test.ts`
- Forward jump when a rule matches.
- First-matching-rule-wins across multiple rules.
- No-match fall-through to the linear next section.
- END/submit sentinel target returns `{ kind: "submit" }`.
- Submit returned when there is no next section.
- Malformed-target fall-through: unknown id, self target, backward target.
- Operator semantics verbatim, including the `contains` asymmetry
  (array branch case-SENSITIVE: `["Blue"]` vs `"blue"` → no match; scalar
  branch case-INSENSITIVE: `"Blue"` vs `"blue"` → match; `equals` array
  membership; `equals` scalar case-sensitive).
- `computeReachedSections`: empty form → empty set; linear form reaches all;
  skipped middle section absent from the set (skipped-section-not-enforced);
  submit-sentinel stops the walk; crafted would-be cycle terminates.

### API unit tests — `apps/api/src/modules/forms/form.service.test.ts`
- Required question in a SKIPPED section does NOT block submission.
- Required question in a REACHED section STILL blocks.
- Per-question visibility still composes within a reached section.
- A supplied answer for a skipped-section question is still type-validated.
- Unknown question id still rejected (reachability-independent).
- `nextSectionAfter` forward jump + malformed-target fall-through at the helper
  level (both `export`ed from `form.service.ts`).
- `computeReachedSections` omits a skipped middle section.

## Notes
- The web (`sectionJumps.ts`) and API (`form.service.ts`) replay copies are
  intentionally duplicated, mirroring the existing
  `evaluateConditions` ↔ `isQuestionVisibleFor` split. Both test tables exercise
  the same operator cases to catch drift.
- `stripAnswerKeys` already spreads `...section`, so `jumpRules` flows into the
  public payload with no change (Decision 5, verify-only — confirmed by reading
  the implementation).
- `getFormSchema` passes sections through untouched, so storage needed no change
  beyond `updateSection` persistence.
