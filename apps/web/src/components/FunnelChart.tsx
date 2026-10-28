// CSS stepped funnel: Views -> Starts -> Completions.
// Bars in brand blue (#2563eb) with a green (#16a34a) completion row.
// Conversion % + drop-off are shown between rows, but are SUPPRESSED (with an
// explanatory note) whenever a cross-question filter is active, because a
// filtered completion count mixed with unfiltered view/start totals would
// produce nonsense percentages (see design §3). A role="img" wrapper carries
// an aria-label text alternative summarizing the whole funnel.

const BLUE = "#2563eb";
const GREEN = "#16a34a";

export type FunnelData = {
  views: number;
  starts: number;
  completions: number;
  viewToStart: number | null;
  startToCompletion: number | null;
  viewToCompletion: number | null;
  filterAffectsCompletionsOnly: boolean;
};

type Stage = {
  key: "views" | "starts" | "completions";
  label: string;
  count: number;
  color: string;
};

// Width of a bar as a share of the top (views) stage, clamped to [0,100].
// When views is 0 we fall back to the largest stage so bars are still visible.
function barWidth(count: number, top: number): number {
  if (top <= 0) return count > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (count / top) * 100));
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

// A human sentence describing the funnel for screen readers.
function ariaSummary(d: FunnelData): string {
  const base = `Funnel: ${d.views} views, ${d.starts} starts, ${d.completions} completions.`;
  if (d.filterAffectsCompletionsOnly) {
    return `${base} Conversion percentages are hidden because an answer filter is active; showing ${d.completions} matching responses.`;
  }
  const overall = d.viewToCompletion === null ? "not available" : `${d.viewToCompletion} percent`;
  return `${base} Overall conversion ${overall}.`;
}

export function FunnelChart({ data }: { data: FunnelData }) {
  const filtered = data.filterAffectsCompletionsOnly;
  const top = data.views;
  const startsOverViews = data.views > 0 && data.starts > data.views;

  const stages: Stage[] = [
    { key: "views", label: "Views", count: data.views, color: BLUE },
    { key: "starts", label: "Starts", count: data.starts, color: BLUE },
    { key: "completions", label: "Completions", count: data.completions, color: GREEN },
  ];

  // Badge copy for view/start rows when an answer filter is active (design §3).
  const unfilterableBadge = "total (not answer-filterable)";

  return (
    <div className="funnel" role="img" aria-label={ariaSummary(data)}>
      {stages.map((stage, i) => {
        const width = barWidth(stage.count, top);
        // When starts > views, we clamp starts to the view width and note ≥100%.
        const clampedNote = stage.key === "starts" && startsOverViews;
        const showStageBadge = filtered && (stage.key === "views" || stage.key === "starts");

        // The conversion/drop-off between THIS row and the next.
        let transition: { label: string; dropLabel: string } | null = null;
        if (!filtered && i < stages.length - 1) {
          const rate = stage.key === "views" ? data.viewToStart : data.startToCompletion;
          if (rate !== null) {
            const drop = Math.max(0, 100 - rate);
            transition = { label: `${pct(rate)} continue`, dropLabel: `−${drop}% drop-off` };
          } else {
            transition = { label: "—", dropLabel: "no rate" };
          }
        }

        return (
          <div key={stage.key} className="funnel-step-group">
            <div className="funnel-row">
              <div className="funnel-row-head">
                <span className="funnel-label">{stage.label}</span>
                <span className="funnel-count">
                  {stage.count.toLocaleString()}
                  {showStageBadge ? (
                    <span className="funnel-badge" title="View and start events happen before a response exists, so they can't be filtered by an answer.">
                      {unfilterableBadge}
                    </span>
                  ) : null}
                  {clampedNote ? (
                    <span className="funnel-badge" title="More starts than views (reloads or cached pages). Shown at full width.">
                      ≥100%
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="funnel-track">
                <div
                  className="funnel-bar"
                  style={{ width: `${width}%`, background: stage.color }}
                />
              </div>
            </div>

            {transition ? (
              <div className="funnel-transition">
                <span className="funnel-continue">{transition.label}</span>
                <span className="funnel-drop">{transition.dropLabel}</span>
              </div>
            ) : null}
          </div>
        );
      })}

      {filtered ? (
        <p className="funnel-note muted">
          Showing {data.completions.toLocaleString()} response
          {data.completions === 1 ? "" : "s"} matching your filter. Conversion rates are hidden
          because views and starts can't be filtered by an answer.
        </p>
      ) : null}
    </div>
  );
}
