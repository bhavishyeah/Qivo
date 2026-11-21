type Props = {
  sections: { id: string; title?: string | null }[];
  currentIndex: number;
  onJump: (index: number) => void;
};

/** Shown while a respondent edits a saved response. */
export default function ReviewBanner({ sections, currentIndex, onJump }: Props) {
  const total = sections.length;
  const isLast = currentIndex === total - 1;
  return (
    <div className="public-edit-banner" role="status" data-testid="review-banner">
      <strong>Review and update</strong>
      <span> Your previous answers are filled in. Change what you need, then save.</span>
      {total > 1 ? (
        <span className="public-edit-jump">
          <label htmlFor="edit-jump-section">Jump to section </label>
          <select
            id="edit-jump-section"
            value={currentIndex}
            onChange={(e) => onJump(Number(e.target.value))}
          >
            {sections.map((s, i) => (
              <option key={s.id} value={i}>
                {i + 1}. {s.title || `Section ${i + 1}`}
              </option>
            ))}
          </select>
          {!isLast ? (
            <button type="button" className="secondary-button" onClick={() => onJump(total - 1)}>
              Skip to last section
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
