// Hero stat grid for the reports dashboard: Views / Starts / Completions /
// Completion rate / Avg. time. Reuses the .response-summary card styling but in
// an auto-fit hero grid so the row collapses 5 -> 2 -> 1 responsively.
//
// When a cross-question filter is active, the Views and Starts cards carry a
// small badge clarifying that those numbers are NOT answer-filtered (they are
// pre-response events). Completion rate headline is start->completion, with
// view->completion as a subline (design §3 / §6).

export type StatCardsData = {
  views: number;
  starts: number;
  completions: number;
  completionRateViews: number | null; // view -> completion %
  completionRateStarts: number | null; // start -> completion % (headline)
  avgTime: { medianSeconds: number | null; meanSeconds: number | null; sampleSize: number };
  filterActive: boolean;
  rangeActive: boolean;
};

// Format a second count as a compact human duration (e.g. "2m 05s", "45s").
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function Badge({ rangeActive }: { rangeActive: boolean }) {
  const label = rangeActive ? "range total" : "total";
  return (
    <span
      className="stat-badge"
      title="View and start events happen before a response exists, so they can't be filtered by an answer."
    >
      {label} (not answer-filterable)
    </span>
  );
}

export function StatCards({ data }: { data: StatCardsData }) {
  const avgHeadline = formatDuration(data.avgTime.medianSeconds);
  const avgSub =
    data.avgTime.sampleSize === 0
      ? "Not enough timing data yet"
      : `Based on ${data.avgTime.sampleSize} response${data.avgTime.sampleSize === 1 ? "" : "s"}${
          data.avgTime.meanSeconds !== null
            ? ` · mean ${formatDuration(data.avgTime.meanSeconds)}`
            : ""
        }`;

  return (
    <section className="stat-hero" aria-label="Summary metrics">
      <div className="stat-card">
        <span className="summary-label">
          Views {data.filterActive ? <Badge rangeActive={data.rangeActive} /> : null}
        </span>
        <strong>{data.views.toLocaleString()}</strong>
      </div>

      <div className="stat-card">
        <span className="summary-label">
          Starts {data.filterActive ? <Badge rangeActive={data.rangeActive} /> : null}
        </span>
        <strong>{data.starts.toLocaleString()}</strong>
      </div>

      <div className="stat-card">
        <span className="summary-label">Completions</span>
        <strong>{data.completions.toLocaleString()}</strong>
      </div>

      <div className="stat-card">
        <span className="summary-label">Completion rate</span>
        <strong>{pct(data.completionRateStarts)}</strong>
        <span className="stat-subline muted">
          {data.completionRateStarts === null ? "start → completion" : "start → completion"}
          {" · "}
          {pct(data.completionRateViews)} view → completion
        </span>
      </div>

      <div className="stat-card">
        <span className="summary-label">Avg. time (approx.)</span>
        <strong>{avgHeadline}</strong>
        <span className="stat-subline muted" title="Measured in the respondent's browser from first interaction to submit.">
          {avgSub}
        </span>
      </div>
    </section>
  );
}
