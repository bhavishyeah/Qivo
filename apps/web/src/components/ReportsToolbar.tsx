// The sticky controls bar for the reports dashboard (design §8.2):
//  - date-range segmented presets (Last 7 / Last 30 / All time / Custom) as a
//    role="group" of aria-pressed buttons,
//  - two native <input type="date"> pickers revealed for Custom,
//  - a cross-question filter builder ([question ▾][operator ▾][value]) that
//    emits an active-filter chip with an aria-labelled clear button,
//  - an "active scope" line summarizing the current state.
//
// The toolbar is controlled: it owns no fetch logic and no debounce. It emits
// onRangeChange / onFilterChange and the page owns the ~300ms debounce.

export type RangePreset = "7d" | "30d" | "all" | "custom";

export type RangeState = {
  preset: RangePreset;
  // ISO date strings (yyyy-mm-dd) for the custom pickers; empty when unset.
  from: string;
  to: string;
};

export type FilterOperator = "equals" | "not_equals" | "contains" | "not_empty";

export type FilterState = {
  questionId: string;
  operator: FilterOperator;
  value: string;
} | null;

export type ToolbarQuestion = { id: string; label: string };

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  not_empty: "is not empty",
};

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

function presetLabel(range: RangeState): string {
  if (range.preset === "all") return "All time";
  if (range.preset === "7d") return "Last 7 days";
  if (range.preset === "30d") return "Last 30 days";
  if (range.from && range.to) return `${range.from} – ${range.to}`;
  return "Custom range";
}

export function ReportsToolbar({
  range,
  filter,
  questions,
  scopeCount,
  onRangeChange,
  onFilterChange,
}: {
  range: RangeState;
  filter: FilterState;
  questions: ToolbarQuestion[];
  scopeCount: number | null;
  onRangeChange: (next: RangeState) => void;
  onFilterChange: (next: FilterState) => void;
}) {
  // The "draft" filter inputs are held by the parent-less controlled pattern:
  // we derive them from `filter` when present, else sensible defaults. To keep
  // this component controlled and simple, the builder writes through to
  // onFilterChange only on Apply; the chip reflects the committed filter.
  const draftQuestionId = filter?.questionId ?? (questions[0]?.id ?? "");
  const draftOperator: FilterOperator = filter?.operator ?? "equals";
  const draftValue = filter?.value ?? "";

  const customInvalid =
    range.preset === "custom" && Boolean(range.from && range.to) && range.from > range.to;

  function selectPreset(preset: RangePreset) {
    if (preset === "custom") {
      onRangeChange({ ...range, preset: "custom" });
    } else {
      onRangeChange({ preset, from: "", to: "" });
    }
  }

  function applyFilter(next: { questionId: string; operator: FilterOperator; value: string }) {
    if (!next.questionId) return;
    if (next.operator !== "not_empty" && next.value.trim() === "") return;
    onFilterChange({
      questionId: next.questionId,
      operator: next.operator,
      value: next.operator === "not_empty" ? "" : next.value,
    });
  }

  const activeQuestionLabel =
    filter && questions.find((q) => q.id === filter.questionId)?.label;

  return (
    <div className="reports-toolbar">
      <div className="reports-toolbar-row">
        {/* Date-range segmented presets */}
        <div className="segmented" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`segmented-btn${range.preset === p.key ? " is-active" : ""}`}
              aria-pressed={range.preset === p.key}
              onClick={() => selectPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom pickers */}
        {range.preset === "custom" ? (
          <div className="custom-range">
            <label className="custom-range-field">
              <span className="sr-only">From date</span>
              <input
                type="date"
                aria-label="From date"
                value={range.from}
                max={range.to || undefined}
                onChange={(e) => onRangeChange({ ...range, from: e.target.value })}
              />
            </label>
            <span aria-hidden="true" className="custom-range-sep">
              →
            </span>
            <label className="custom-range-field">
              <span className="sr-only">To date</span>
              <input
                type="date"
                aria-label="To date"
                value={range.to}
                min={range.from || undefined}
                onChange={(e) => onRangeChange({ ...range, to: e.target.value })}
              />
            </label>
          </div>
        ) : null}
      </div>

      {customInvalid ? (
        <p className="toolbar-error" role="alert">
          The start date must be on or before the end date.
        </p>
      ) : null}

      {/* Filter builder */}
      <div className="reports-toolbar-row filter-builder">
        {questions.length > 0 ? (
          <FilterBuilder
            questions={questions}
            draftQuestionId={draftQuestionId}
            draftOperator={draftOperator}
            draftValue={draftValue}
            onApply={applyFilter}
          />
        ) : (
          <span className="muted">No questions available to filter.</span>
        )}
      </div>

      {/* Active filter chip */}
      {filter ? (
        <div className="filter-chip-row">
          <span className="filter-chip">
            Where <strong>{activeQuestionLabel ?? "question"}</strong>{" "}
            {OPERATOR_LABELS[filter.operator]}
            {filter.operator !== "not_empty" ? (
              <>
                {" "}
                <strong>&ldquo;{filter.value}&rdquo;</strong>
              </>
            ) : null}
            <button
              type="button"
              className="filter-chip-clear"
              aria-label="Remove filter"
              onClick={() => onFilterChange(null)}
            >
              ✕
            </button>
          </span>
        </div>
      ) : null}

      {/* Active-scope line */}
      <p className="scope-line muted">
        Showing <strong>{presetLabel(range)}</strong>
        {scopeCount !== null ? (
          <>
            {" · "}
            {filter ? "filtered to " : ""}
            {scopeCount.toLocaleString()} response{scopeCount === 1 ? "" : "s"}
          </>
        ) : null}
        {range.preset !== "all" ? " · day boundaries are UTC" : null}
      </p>
    </div>
  );
}

// The inline builder holds its own draft state via uncontrolled selects seeded
// from props; on Apply it bubbles the committed filter up. Kept as an inner
// component so the chip (committed) and the builder (draft) stay independent.
function FilterBuilder({
  questions,
  draftQuestionId,
  draftOperator,
  draftValue,
  onApply,
}: {
  questions: ToolbarQuestion[];
  draftQuestionId: string;
  draftOperator: FilterOperator;
  draftValue: string;
  onApply: (next: { questionId: string; operator: FilterOperator; value: string }) => void;
}) {
  return (
    <form
      className="filter-builder-inner"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const q = (form.elements.namedItem("filterQuestion") as HTMLSelectElement).value;
        const op = (form.elements.namedItem("filterOperator") as HTMLSelectElement)
          .value as FilterOperator;
        const valEl = form.elements.namedItem("filterValue") as HTMLInputElement | null;
        onApply({ questionId: q, operator: op, value: valEl ? valEl.value : "" });
      }}
    >
      <label className="filter-field">
        <span className="sr-only">Filter question</span>
        <select name="filterQuestion" defaultValue={draftQuestionId} aria-label="Filter question">
          {questions.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        <span className="sr-only">Filter operator</span>
        <OperatorSelect defaultValue={draftOperator} />
      </label>

      <ValueField defaultOperator={draftOperator} defaultValue={draftValue} />

      <button type="submit" className="filter-apply">
        Apply filter
      </button>
    </form>
  );
}

// A controlled operator select that toggles the value field's presence by
// reading from the DOM form; kept uncontrolled here with native change to hide
// the value input for not_empty. We mirror the operator into a data attribute
// consumed by sibling CSS/JS via the form's onChange on the wrapper.
function OperatorSelect({ defaultValue }: { defaultValue: FilterOperator }) {
  return (
    <select
      name="filterOperator"
      defaultValue={defaultValue}
      aria-label="Filter operator"
      onChange={(e) => {
        // Toggle the sibling value input disabled/hidden state for not_empty.
        const form = e.currentTarget.form;
        if (!form) return;
        const valWrap = form.querySelector<HTMLElement>("[data-value-field]");
        if (valWrap) {
          valWrap.style.display = e.currentTarget.value === "not_empty" ? "none" : "";
        }
      }}
    >
      {(Object.keys(OPERATOR_LABELS) as FilterOperator[]).map((op) => (
        <option key={op} value={op}>
          {OPERATOR_LABELS[op]}
        </option>
      ))}
    </select>
  );
}

function ValueField({
  defaultOperator,
  defaultValue,
}: {
  defaultOperator: FilterOperator;
  defaultValue: string;
}) {
  return (
    <label
      className="filter-field"
      data-value-field
      style={{ display: defaultOperator === "not_empty" ? "none" : undefined }}
    >
      <span className="sr-only">Filter value</span>
      <input
        type="text"
        name="filterValue"
        defaultValue={defaultValue}
        placeholder="Value"
        aria-label="Filter value"
      />
    </label>
  );
}
