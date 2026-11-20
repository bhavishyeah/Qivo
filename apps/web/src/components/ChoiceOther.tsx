import { MAX_OTHER_LEN } from "../lib/otherOption";

/**
 * The extra last choice "Other:" of a single or multiple choice question: a
 * radio or checkbox plus a text input that is enabled (and required) only while
 * the choice is selected. Shared by the public form and the editor preview.
 */
export default function ChoiceOther({
  kind,
  name,
  inputId,
  checked,
  text,
  invalid,
  onCheckedChange,
  onTextChange,
  onBlur,
}: {
  kind: "radio" | "checkbox";
  name: string;
  inputId: string;
  checked: boolean;
  text: string;
  invalid?: boolean | undefined;
  onCheckedChange: (checked: boolean) => void;
  onTextChange: (text: string) => void;
  onBlur?: (() => void) | undefined;
}) {
  const textId = `${inputId}-other-text`;
  return (
    <div className="choice-other">
      <label className="choice-item choice-item-other">
        <input
          type={kind}
          name={kind === "radio" ? name : undefined}
          checked={checked}
          onChange={(event) => onCheckedChange(kind === "radio" ? true : event.target.checked)}
        />
        <span>Other:</span>
      </label>
      <input
        id={textId}
        type="text"
        className="choice-other-input"
        value={checked ? text : ""}
        maxLength={MAX_OTHER_LEN}
        disabled={!checked}
        required={checked}
        aria-label="Other, please specify"
        aria-required={checked ? true : undefined}
        aria-invalid={invalid && checked ? true : undefined}
        onChange={(event) => onTextChange(event.target.value)}
        onBlur={onBlur}
        autoComplete="off"
      />
    </div>
  );
}
