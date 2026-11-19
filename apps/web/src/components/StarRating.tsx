import { useState } from "react";

/**
 * Star rating for respondents. Native radio inputs (visually hidden) keep the
 * group keyboard accessible; the stars fill up to the selected or hovered value.
 */
export function StarRating({
  name,
  min,
  max,
  value,
  onChange,
  labelledBy,
  describedBy,
  required,
  invalid,
  disabled,
}: {
  name: string;
  min: number;
  max: number;
  value: number | null;
  onChange: (value: number) => void;
  labelledBy: string;
  describedBy?: string | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const stars = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const shown = hover ?? value ?? 0;
  return (
    <div
      className="star-rating"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-required={required ? true : undefined}
      aria-invalid={invalid ? true : undefined}
      onMouseLeave={() => setHover(null)}
    >
      {stars.map((n) => (
        <label
          key={n}
          className={`star-rating-item${n <= shown ? " is-filled" : ""}`}
          onMouseEnter={() => setHover(n)}
        >
          <input
            type="radio"
            name={name}
            value={n}
            checked={value === n}
            disabled={disabled}
            aria-label={`${n} of ${max} stars`}
            onChange={() => onChange(n)}
          />
          <span aria-hidden="true">{"\u2605"}</span>
        </label>
      ))}
    </div>
  );
}