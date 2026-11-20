import { useState } from "react";

type ColorFieldProps = {
  id: string;
  label: string;
  /** Hex value like "#42005f", or "" when unset. */
  value: string;
  /** Colour the swatch shows while unset. */
  fallback: string;
  onChange: (hex: string) => void;
  help?: string;
  /** Text of the reset button; it shows only while a value is set. */
  resetLabel?: string;
  /** Placeholder of the hex input while unset. */
  placeholder?: string;
};

const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** Swatch button plus hex text input. The native colour input stays underneath for the picker. */
export default function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
  help,
  resetLabel = "Reset",
  placeholder = "#000000",
}: ColorFieldProps) {
  // While the hex box is focused, show what the user is typing; otherwise mirror the value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;

  function onText(next: string) {
    setDraft(next);
    const match = HEX_RE.exec(next.trim());
    if (match) onChange(`#${match[1]!.toLowerCase()}`);
  }

  return (
    <div className="ap-field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {help ? <p className="field-help">{help}</p> : null}
      <div className="ap-color">
        <input
          id={id}
          className="ap-swatch"
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className="input ap-hex"
          type="text"
          aria-label={`${label} hex value`}
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => onText(e.target.value)}
          onFocus={() => setDraft(value)}
          onBlur={() => setDraft(null)}
        />
        {value ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>
            {resetLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
