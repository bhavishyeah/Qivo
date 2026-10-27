# MULTI_ENTRY question type across the Qivo form stack

This change adds a new `MULTI_ENTRY` question type that lets respondents enter multiple free-text values (e.g., team members' names) in a dynamic list, replacing the comma-separated-text workaround. The implementation touches all seven required layers: the shared type union, the Zod schema enum, the service validator, the form editor, the public renderer, the preview renderer, and the reports page. Both the API TypeScript check and the web Vite build pass with zero errors.

Watch for: MULTI_ENTRY answers land in the `kind: "text"` bucket of the reports aggregator, where `String(answer)` on a `string[]` produces `"Name1,Name2"` — the report shows the stringified array as a single sample string rather than individual entries. Functional, but the representation is crude and could confuse form owners reading their reports.

**Verdict**: APPROVED

---

## High-level view

The type union, Zod enum, and service-local union are updated in lock-step, so a MULTI_ENTRY question round-trips from editor through API without type errors or schema rejections.

The public renderer initialises the answer state as `[""]` when no array is present, keeps the remove button hidden when only one entry exists, and clears down to a single empty entry rather than an empty array on the last removal — all three edge cases are handled correctly.

The server-side required-field check treats an array of all-blank strings as missing, mirroring the client's `validateSection`/`validateAll` logic exactly. A crafted request supplying `["", ""]` for a required MULTI_ENTRY question is rejected at two independent checkpoints (the required check and the per-answer type validator).

The reports aggregator has no special branch for MULTI_ENTRY; it falls through to the generic text bucket, which calls `String(answer)` on each response value. Because a MULTI_ENTRY answer is a `string[]`, that produces `"Name1,Name2"` in the sample — correct enough to ship, but individual entries are not separated. The `isAnswered` helper correctly counts a non-empty array as answered, so the counters are accurate.

The response dashboard's `formatResponseValue` already renders arrays with `value.join(", ")`, so MULTI_ENTRY answers display cleanly in the individual-response and CSV export views without any new code.

---

<details>
<summary>Issues (1)</summary>

1. **MULTI_ENTRY report sample stringification** — `getFormReport` falls through to the text bucket and calls `String(answer)` on each response value. For a `string[]`, this produces `"Name1,Name2"` as a single sample string. Add an explicit MULTI_ENTRY branch that flattens the array (`answers.flatMap(a => Array.isArray(a) ? a : [String(a)])`), so each individual entry appears as its own row in the sample rather than a concatenated blob. Confidence: **confirmed** (`form.service.ts` ~line 2125).

</details>

---

<details>
<summary>Details</summary>

## Required-field edge cases across client and server

`validateSection` in `PublicFormPage` and `validateAll` both check `Array.isArray(answer)` before calling `.every(e => !e.trim())`, meaning an array of all-blank strings is correctly treated as unanswered. The server's `missingRequiredQuestion` check applies the identical logic: `!Array.isArray(answer) || (answer as unknown[]).every(v => v === "" || v === null || v === undefined)`. Both sides treat `undefined`, `null`, a missing key, and an array of all-blank strings as "no answer provided" — confirmed consistent.

## Remove-button guard and initial-state invariant

`removeEntry` never shrinks the list below one element: `onChange(question.id, next.length > 0 ? next : [""])`. The remove button is only rendered when `entries.length > 1`. A respondent can never reach a zero-entry state. The `QuestionField` component initialises entries from `value` only if `Array.isArray(value)`, falling back to `[""]`. `FormPreviewPage` mirrors this behaviour identically.

## MULTI_ENTRY in the reports aggregator

`getFormReport` dispatches on question type through a series of `if` branches; MULTI_ENTRY matches none of the special branches and falls through to:

```ts
const sample = answers.slice(0, 20).map((a) => String(a));
return { ...base, kind: "text", sample };
```

`String(["Alice", "Bob"])` produces `"Alice,Bob"` — a single comma-joined string. The `TextSummary` component renders each element of `sample` as a separate row, so the form owner sees one row reading `"Alice,Bob"` instead of two rows `"Alice"` and `"Bob"`. The `isAnswered` helper correctly counts non-empty arrays as answered (it only treats `[]` as unanswered), so the answered/skipped counters remain accurate.

Recommended fix before the reports page sees real MULTI_ENTRY traffic:

```ts
if (question.type === "MULTI_ENTRY") {
  const sample = answers
    .flatMap((a) => (Array.isArray(a) ? a : [String(a)]))
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .slice(0, 20);
  return { ...base, kind: "text", sample };
}
```

</details>

---

<details>
<summary>Files changed</summary>

- `apps/web/src/types/index.ts` — added `"MULTI_ENTRY"` to `QuestionType` union
- `apps/api/src/modules/forms/form.schemas.ts` — added `"MULTI_ENTRY"` to `questionTypeSchema` Zod enum
- `apps/api/src/modules/forms/form.service.ts` — added `MULTI_ENTRY` to local `QuestionType`; added `MULTI_ENTRY` case in `validateAnswerAgainstQuestion`; fixed required-answer check in `submitFormResponse`
- `apps/web/src/pages/FormEditorPage.tsx` — added `MULTI_ENTRY: "Multi-Entry"` to `QUESTION_TYPE_LABELS`; added static preview block in `QuestionCard`
- `apps/web/src/pages/PublicFormPage.tsx` — added `MULTI_ENTRY` branch in `QuestionField`; fixed `validateSection` and `validateAll` emptiness checks
- `apps/web/src/pages/FormPreviewPage.tsx` — added `MULTI_ENTRY` branch in `PreviewQuestion`
- `apps/web/src/pages/FormReportsPage.tsx` — added `"MULTI_ENTRY"` to local `QuestionType` union

Full diff: `git diff main` in the workspace root.

</details>
