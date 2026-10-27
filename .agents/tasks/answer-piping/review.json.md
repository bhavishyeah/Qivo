# Answer piping in question labels (labels only)

A later question's label can now reference an earlier question's live answer through a `{{questionId}}` token, resolved at render time in both the public form and the editor preview. The change adds one pure resolver (`apps/web/src/lib/piping.ts`), wires it into the two respondent-facing renderers, and gives the editor an "Insert answer reference" dropdown plus a muted placeholder preview line. It is display-only — no answer storage, validation, or backend behavior changes — and it faithfully mirrors the approved design and plan.

Watch for: nothing blocking. The implementation matches the design decision-for-decision; the one known v1 gap (raw tokens in the confirmation email / analytics labels) was explicitly ruled out of scope by the design. **(confirmed)**

**Verdict**: APPROVED

## High-level view

The resolver is a pure `label.replace(PIPING_TOKEN_RE, ...)` over a `Map<id, Question>` built per call. Its emptiness test is a byte-for-byte match of `PublicFormPage.validateSection` (array: `length === 0 || every(e => !e.trim())`; scalar: `undefined | null | ""`), so "answered for piping" and "answered for validation" can never disagree. Value rendering mirrors `conditions.ts`: string as-is, `string[]` joined with `", "` skipping blanks, number stringified, with choice value→label resolution layered on for `SINGLE_CHOICE` / `MULTIPLE_CHOICE` / `YES_NO`.

The fallback rule is implemented exactly as specified: unknown id drops to `""`; known-but-unanswered splits on `required` — required renders `[answer "<trimmed label>" first]` (no recursive resolution of the referenced label), optional renders `""`. Malformed tokens (`{{`, `{{}}`, `{{ foo-bar }}`) never match the regex and pass through verbatim.

Both renderers call the same resolver at the single point where `question.label` is rendered, giving true parity. `PublicFormPage` also routes `resolvedLabel` into the RATING and LINEAR_SCALE `aria-label`s (the preview page has no such aria-labels, correctly left untouched). The MULTI_ENTRY per-entry aria-label stays raw, as the design intended.

The editor's insert dropdown reuses the exact earlier-questions filter from `ConditionEditor`, appends a well-formed `{{id}}` token with correct spacing, disables with the same "Add questions above first" affordance, and resets after selection. A separate editor-only helper renders a readable `Preview:` line using `.match()` to avoid the stateful `/g` regex's `lastIndex` hazard.

<details>
<summary>Issues (0)</summary>

No blocking or non-blocking action items. The implementation conforms to the approved design and plan.

</details>

<details>
<summary>Details</summary>

### Resolver fidelity to the conditions.ts precedent

`resolvePipedLabel` builds a `Map<string, Question>` once per call and runs a single `label.replace(PIPING_TOKEN_RE, (_match, id) => ...)`. The emptiness check in `isUnanswered` reproduces `PublicFormPage.validateSection` precisely — arrays are unanswered when `length === 0` or every entry is blank after `.trim()`, scalars when `undefined`, `null`, or `""`. Because the design pins "answered for piping" to the same test validation uses, a piped reference can't show an answer the form would still reject as missing, and can't fall into the fallback path for a value validation would accept.

`renderAnswerValue` follows the `conditions.ts` style and adds the choice-label resolution the design called for in v1: `MULTIPLE_CHOICE` maps each selected value through `options.find(o => o.value === v)?.label ?? v` then joins with `", "`; `SINGLE_CHOICE` does the single-value equivalent; `YES_NO` uses a built-in `{ yes: "Yes", no: "No" }` map with raw fallback; everything else is string-as-is or `String(value)` for numbers. The per-entry raw-value fallback for a deleted option is present and tested.

### Fallback rule — exact match to spec

The three branches are exactly as specified. Unknown id → `""` (dangling reference to a deleted question is dropped, never leaked). Known + unanswered + required → `` `[answer "${q.label.trim()}" first]` `` with the referenced label inserted raw (not recursively resolved), avoiding recursion. Known + unanswered + optional → `""`. The required case trims the referenced label, and the test `required + unanswered renders the exact fallback copy` asserts the trimmed form (`"Team captain name "` → `[answer "Team captain name" first]`).

### Live parity across both renderers

Both `PublicFormPage.QuestionField` and `FormPreviewPage.PreviewQuestion` compute `resolvedLabel = resolvePipedLabel(question.label, allQuestions, answers)` and render it in the `<span className="question-label">`. `FormPreviewPage` adds a form-wide `allQuestions = useMemo(() => sections.flatMap(s => s.questions), [sections])` distinct from its existing current-section `questions` memo, so cross-section references resolve in preview just as they do publicly. Both components re-render on `answers` changes, so updates are live with no new state or effects. `PublicFormPage` additionally feeds `resolvedLabel` into the RATING and LINEAR_SCALE `role="radiogroup"` `aria-label`s; the preview page has no such aria-labels and is correctly left alone.

### Editor insert affordance and preview

The insert `<select>` sits directly beneath the "Question label" input. `earlierQuestions` uses the identical filter found in `ConditionEditor` (`q.id !== question.id && allQuestions.indexOf(q) < allQuestions.indexOf(question)`), so only earlier questions are offered and forward/self references can't be authored through the UI. Selecting an option appends `{{id}}` with the design's separator logic (`sep = question.label && !question.label.endsWith(" ") ? " " : ""`), then resets the control to its placeholder. It is disabled with `title="Add questions above first"` when no earlier question exists, mirroring the condition editor. `e.stopPropagation()` on click matches the sibling inputs.

The `Preview:` line is produced by `previewLabelWithPlaceholders`, an editor-only helper that replaces each token with `[<referenced label>]` or `[unknown reference]`. It reuses the single `PIPING_TOKEN_RE` source and guards against the stateful `/g` regex by using `question.label.match(PIPING_TOKEN_RE)` for the `hasTokens` test and `.replace` for rendering — both reset `lastIndex` safely, so there's no cross-render flicker.

### Scope and backend

`resolvePipedLabel` is applied only to labels (the `question-label` spans and the two aria-labels). A workspace-wide search confirms no piping call touches descriptions or the confirmation message, matching the labels-only scope. The diff stat shows no `apps/api/**` changes, consistent with the design's conclusion that labels are already stored and served verbatim so the backend needs no change. The raw-token appearance in the confirmation email and analytics labels is the documented, accepted v1 limitation.

### Test coverage

`piping.test.ts` has 14 pure-resolver tests covering every case the design's Testability section lists: single token, whitespace inside braces, multiple tokens, unknown id → `""`, malformed/partial braces passthrough, required-unanswered exact fallback (with trim), optional-unanswered blank, plain string, number stringification, MULTI_ENTRY join with blank-entry skipping, SINGLE_CHOICE and MULTIPLE_CHOICE value→label, YES_NO mapping, and option-deleted raw fallback.

Not tested: the component-level live-update render path (prop wiring in `QuestionField` / `PreviewQuestion`) and the editor insert/preview behavior are not covered by automated tests — the design flagged these as component/integration candidates, and the commit documents them via a manual end-to-end trace instead. Acceptable for this scope given no component test harness exists, but worth noting as the untested surface.

### Verification evidence

The commit message records: `tsc -b --noEmit` exit 0, `vite build` exit 0, `vitest run` 14/14 passed, eslint clean on the new/changed files except two pre-existing errors in untouched `FormEditorPage.tsx` code (`Date.now` purity L192, use-before-declare L277), and a step-by-step end-to-end trace of the live-resolution, fallback, string[] join, malformed-token, and editor-source-filtering behaviors. No `apps/api` files changed, so the API typecheck was correctly skipped. The evidence is complete and internally consistent with the diff; no re-run or spot-check was warranted.

</details>

<details>
<summary>File map</summary>

- `apps/web/src/lib/piping.ts` — **new.** `PIPING_TOKEN_RE`, `resolvePipedLabel`, internal `isUnanswered` / `renderAnswerValue`.
- `apps/web/src/lib/piping.test.ts` — **new.** 14 resolver unit tests.
- `apps/web/src/pages/PublicFormPage.tsx` — `QuestionField` gains `allQuestions`+`answers`; renders `resolvedLabel`; RATING/LINEAR_SCALE aria-labels use it.
- `apps/web/src/pages/FormPreviewPage.tsx` — adds form-wide `allQuestions`; `PreviewQuestion` renders `resolvedLabel` for parity.
- `apps/web/src/pages/FormEditorPage.tsx` — active `QuestionCard` insert `<select>` (earlier-questions-only, appends `{{id}}`) + muted `Preview:` line via `previewLabelWithPlaceholders`.
- `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.node.json`, `pnpm-lock.yaml` — vitest tooling.

Full diff: `git diff HEAD~1 HEAD`.

</details>
