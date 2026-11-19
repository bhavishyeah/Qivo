import type { Question, QuestionOption } from "../types";

function nextValue(prefix: string, list: QuestionOption[]): string {
  let n = list.length + 1;
  while (list.some((o) => o.value === `${prefix}_${n}`)) n += 1;
  return `${prefix}_${n}`;
}

function OptionList({
  title,
  prefix,
  noun,
  items,
  onChange,
}: {
  title: string;
  prefix: string;
  noun: string;
  items: QuestionOption[];
  onChange: (items: QuestionOption[]) => void;
}) {
  return (
    <div className="grid-editor-list">
      <strong className="grid-editor-title">{title}</strong>
      {items.map((item, idx) => (
        <div className="editor-option-row" key={item.value}>
          <span className="grid-editor-index" aria-hidden="true">{idx + 1}.</span>
          <input
            type="text"
            className="editor-option-input"
            aria-label={`${noun} ${idx + 1}`}
            value={item.label}
            maxLength={200}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onChange(items.map((it, i) => (i === idx ? { ...it, label: e.target.value } : it)))
            }
          />
          {items.length > 1 ? (
            <button
              type="button"
              className="editor-option-remove"
              aria-label={`Remove ${noun.toLowerCase()} ${idx + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                onChange(items.filter((_, i) => i !== idx));
              }}
            >
              {"\u00d7"}
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="editor-add-option"
        onClick={(e) => {
          e.stopPropagation();
          onChange([...items, { value: nextValue(prefix, items), label: `${noun} ${items.length + 1}` }]);
        }}
      >
        Add {noun.toLowerCase()}
      </button>
    </div>
  );
}

/** Editor body for multiple-choice and checkbox grids: rows, columns and the per-row requirement. */
export function GridEditor({
  question,
  onChange,
}: {
  question: Question;
  onChange: (id: string, patch: Partial<Question>) => void;
}) {
  const rows = question.settings?.rows ?? [];
  const columns = question.settings?.columns ?? [];
  const patch = (next: Partial<NonNullable<Question["settings"]>>) =>
    onChange(question.id, { settings: { ...question.settings, ...next } });
  return (
    <div className="grid-editor" onClick={(e) => e.stopPropagation()}>
      <div className="grid-editor-lists">
        <OptionList title="Rows" prefix="row" noun="Row" items={rows} onChange={(rows) => patch({ rows })} />
        <OptionList title="Columns" prefix="col" noun="Column" items={columns} onChange={(columns) => patch({ columns })} />
      </div>
      <label className="grid-editor-require">
        <input
          type="checkbox"
          checked={Boolean(question.settings?.requireEachRow)}
          onChange={(e) => patch({ requireEachRow: e.target.checked })}
        />
        Require a response in each row
      </label>
    </div>
  );
}