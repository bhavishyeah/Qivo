import type { AnswerValue, GridAnswer, Question } from "../types";
import { setGridCell } from "../lib/questionTypes";

/**
 * Multiple choice / checkbox grid for respondents: a table with row headers.
 * Each row of radios (or checkboxes) is its own group, and the table scrolls
 * horizontally on narrow screens instead of squeezing the columns.
 */
export function GridQuestion({
  question,
  value,
  onChange,
  describedBy,
  invalid,
  disabled,
}: {
  question: Question;
  value: AnswerValue | undefined;
  onChange: (questionId: string, value: AnswerValue) => void;
  describedBy?: string | undefined;
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const rows = question.settings?.rows ?? [];
  const columns = question.settings?.columns ?? [];
  const isRadio = question.type === "MULTIPLE_CHOICE_GRID";
  const grid: GridAnswer =
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as GridAnswer) : {};
  return (
    <div className="grid-question-scroll">
      <table
        className="grid-question"
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
      >
        <thead>
          <tr>
            <td />
            {columns.map((col) => (
              <th key={col.value} scope="col">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cell = grid[row.value];
            return (
              <tr key={row.value}>
                <th scope="row">{row.label}</th>
                {columns.map((col) => {
                  const checked = Array.isArray(cell) ? cell.includes(col.value) : cell === col.value;
                  return (
                    <td key={col.value}>
                      <label className={`choice-cell ${isRadio ? "is-radio" : "is-checkbox"}`}>
                        <input
                          type={isRadio ? "radio" : "checkbox"}
                          name={`${question.id}-${row.value}`}
                          checked={checked}
                          disabled={disabled}
                          aria-label={`${row.label}, ${col.label}`}
                          onChange={(e) =>
                            onChange(
                              question.id,
                              setGridCell(question.type, value, row.value, col.value, e.target.checked),
                            )
                          }
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}