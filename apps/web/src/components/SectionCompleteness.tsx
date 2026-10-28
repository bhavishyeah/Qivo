// Horizontal per-section completeness bars (design §5). This is a PROXY, not
// true funnel drop-off: partial/abandoned responses are never stored, so this
// shows how completely finished responses filled each section — surfaced
// honestly via the heading note. Rendered in schema section order. The caller
// hides this card entirely for single-section forms (data is null then).

const BLUE = "#2563eb";

export type SectionCompletenessItem = {
  sectionId: string;
  title: string;
  percentage: number;
};

export function SectionCompleteness({ sections }: { sections: SectionCompletenessItem[] }) {
  if (sections.length === 0) return null;

  return (
    <section className="editor-card section-completeness" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">Sections</p>
          <h2>Section completeness</h2>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Of submitted responses. Partial/abandoned responses aren&apos;t stored, so this reflects
        how completely finished responses filled each section — not where people dropped off.
      </p>

      <div className="section-bars">
        {sections.map((s) => {
          const width = Math.max(0, Math.min(100, s.percentage));
          return (
            <div key={s.sectionId} className="section-bar-row">
              <div className="section-bar-head">
                <span className="section-bar-title">{s.title}</span>
                <span className="section-bar-value muted">{s.percentage}%</span>
              </div>
              <div
                className="section-bar-track"
                role="img"
                aria-label={`${s.title}: ${s.percentage}% of submitted responses answered at least one question`}
              >
                <div className="section-bar-fill" style={{ width: `${width}%`, background: BLUE }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
