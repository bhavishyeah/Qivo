import type { QuestionOption, QuestionType } from "../types";
import { useStableKeys } from "../lib/useStableKeys";

/**
 * Option rows for a choice question in the builder. Each row is keyed by a
 * generated stable key (not the typed text), so the input keeps focus and caret
 * while typing.
 */
export default function ChoiceOptionsEditor({
  type,
  options,
  allowsOther,
  otherOn,
  shuffleOn,
  onOptionsChange,
  onAllowOther,
  onShuffleOff,
}: {
  type: QuestionType;
  options: QuestionOption[];
  allowsOther: boolean;
  otherOn: boolean;
  shuffleOn: boolean;
  onOptionsChange: (options: QuestionOption[]) => void;
  onAllowOther: (on: boolean) => void;
  onShuffleOff: () => void;
}) {
  const { keys, addKey, removeKey } = useStableKeys(options.length);

  function addOption() {
    addKey();
    onOptionsChange([
      ...options,
      { value: `option_${Date.now()}`, label: `Option ${options.length + 1}` },
    ]);
  }
  function updateOption(idx: number, label: string) {
    onOptionsChange(
      options.map((o, i) =>
        i === idx ? { ...o, label, value: label.toLowerCase().replace(/\s+/g, "_") || o.value } : o,
      ),
    );
  }
  function removeOption(idx: number) {
    removeKey(idx);
    onOptionsChange(options.filter((_, i) => i !== idx));
  }

  return (
    <div className="editor-options">
      {options.map((option, idx) => (
        <div key={keys[idx]} className="editor-option-row">
          <span className={`editor-option-marker ${type === "MULTIPLE_CHOICE" ? "is-square" : ""}`} aria-hidden="true" />
          <input
            type="text"
            className="editor-option-input"
            value={option.label}
            onChange={(e) => updateOption(idx, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder={`Option ${idx + 1}`}
            aria-label={`Option ${idx + 1}`}
          />
          {options.length > 1 ? (
            <button
              type="button"
              className="editor-option-remove"
              onClick={(e) => { e.stopPropagation(); removeOption(idx); }}
              title="Remove option"
              aria-label="Remove option"
            >
              {"\u00d7"}
            </button>
          ) : null}
        </div>
      ))}
      {allowsOther && otherOn ? (
        <div className="editor-option-row">
          <span className={`editor-option-marker ${type === "MULTIPLE_CHOICE" ? "is-square" : ""}`} aria-hidden="true" />
          <span className="editor-option-other">Other...</span>
          <button
            type="button"
            className="editor-option-remove"
            onClick={(e) => { e.stopPropagation(); onAllowOther(false); }}
            title='Remove "Other"'
            aria-label='Remove "Other" option'
          >
            {"\u00d7"}
          </button>
        </div>
      ) : null}
      <div className="editor-option-row">
        <span className={`editor-option-marker is-ghost ${type === "MULTIPLE_CHOICE" ? "is-square" : ""}`} aria-hidden="true" />
        <button
          type="button"
          className="editor-add-option"
          onClick={(e) => { e.stopPropagation(); addOption(); }}
        >
          Add option
        </button>
        {allowsOther && !otherOn ? (
          <>
            <span className="editor-option-or">or</span>
            <button
              type="button"
              className="editor-add-option"
              onClick={(e) => { e.stopPropagation(); onAllowOther(true); }}
            >
              add &quot;Other&quot;
            </button>
          </>
        ) : null}
      </div>
      {shuffleOn ? (
        <label className="editor-inline-toggle" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked
            onChange={() => onShuffleOff()}
          />
          <span>Shuffle option order{allowsOther && otherOn ? ' ("Other" stays last)' : ""}</span>
        </label>
      ) : null}
    </div>
  );
}