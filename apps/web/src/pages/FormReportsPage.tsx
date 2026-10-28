import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, ApiRequestError } from "../lib/api";
import { isImageUrl } from "../lib/upload";
import { Chips } from "../components/Chips";
import { FunnelChart } from "../components/FunnelChart";
import { StatCards } from "../components/StatCards";
import { SectionCompleteness } from "../components/SectionCompleteness";
import {
  ReportsToolbar,
  type RangeState,
  type FilterState,
  type ToolbarQuestion,
} from "../components/ReportsToolbar";

// ─── Report shapes (strict superset of the API's getFormReport output) ──────

// Render a single text-report sample. File-upload answers are URLs: images
// become thumbnails, other files become "View file" links, plain text is shown
// as a chip.
function renderSampleAnswer(answer: string) {
  if (/^https?:\/\//.test(answer)) {
    if (isImageUrl(answer)) {
      return (
        <a href={answer} target="_blank" rel="noopener noreferrer">
          <img
            src={answer}
            alt="Uploaded file"
            style={{
              maxWidth: 90,
              maxHeight: 90,
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              objectFit: "cover",
              display: "block",
            }}
          />
        </a>
      );
    }
    return (
      <a href={answer} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
        View file
      </a>
    );
  }
  return <Chips items={[answer]} />;
}

type QuestionType =
  | "SHORT_TEXT" | "LONG_TEXT" | "EMAIL" | "NUMBER" | "DATE"
  | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "RATING" | "YES_NO"
  | "PHONE" | "URL" | "FILE_UPLOAD" | "SIGNATURE" | "LINEAR_SCALE" | "MULTI_ENTRY";

type BaseReport = {
  questionId: string;
  label: string;
  type: QuestionType;
  answered: number;
  skipped: number;
};

type ChoiceReport = BaseReport & {
  kind: "choice";
  options: Array<{ name: string; count: number; percentage: number }>;
};
type RatingReport = BaseReport & {
  kind: "rating";
  min: number;
  max: number;
  average: number | null;
  distribution: Array<{ rating: number; count: number }>;
};
type NumberReport = BaseReport & {
  kind: "number";
  average: number | null;
  min: number | null;
  max: number | null;
  sum: number;
};
type TextReport = BaseReport & { kind: "text"; sample: string[] };

type QuestionReport = ChoiceReport | RatingReport | NumberReport | TextReport;

type TimeSeriesPoint = { date: string; views: number; submissions: number };

type FormReport = {
  totalResponses: number;
  analytics: { views: number; submissions: number; conversionRate: number };
  funnel: {
    views: number;
    starts: number;
    completions: number;
    viewToStart: number | null;
    startToCompletion: number | null;
    viewToCompletion: number | null;
    filterAffectsCompletionsOnly: boolean;
  };
  metrics: {
    completionRateViews: number | null;
    completionRateStarts: number | null;
    avgTime: { medianSeconds: number | null; meanSeconds: number | null; sampleSize: number };
    peakDay: { date: string; count: number } | null;
    sectionCompleteness: Array<{ sectionId: string; title: string; percentage: number }> | null;
  };
  range: { from: string | null; to: string | null };
  filterApplied: boolean;
  filter: { questionId: string; operator: string; value?: string } | null;
  warnings: string[];
  timeSeries: TimeSeriesPoint[];
  questions: QuestionReport[];
};

// ─── Range helpers ──────────────────────────────────────────────────────────

const DEFAULT_RANGE: RangeState = { preset: "all", from: "", to: "" };

// Convert the toolbar's RangeState into the ISO {from,to} the API expects.
// Presets are computed relative to "now" in UTC; custom pickers send the chosen
// calendar dates (the server normalizes `to` to end-of-UTC-day, §2.1).
function rangeToParams(range: RangeState): { from?: string; to?: string } {
  if (range.preset === "all") return {};

  if (range.preset === "custom") {
    const params: { from?: string; to?: string } = {};
    if (range.from) params.from = `${range.from}T00:00:00.000Z`;
    if (range.to) params.to = `${range.to}T00:00:00.000Z`;
    return params;
  }

  const days = range.preset === "7d" ? 7 : 30;
  const now = new Date();
  const to = now.toISOString();
  const fromDate = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  fromDate.setUTCHours(0, 0, 0, 0);
  return { from: fromDate.toISOString(), to };
}

// Build the report query string from only the params that are actually set, so
// "All time, no filter" sends the bare endpoint (identical to the old call).
function buildReportQuery(range: RangeState, filter: FilterState): string {
  const parts = new URLSearchParams();
  const { from, to } = rangeToParams(range);
  if (from) parts.set("from", from);
  if (to) parts.set("to", to);
  if (filter) {
    parts.set("filterQuestionId", filter.questionId);
    parts.set("filterOperator", filter.operator);
    if (filter.operator !== "not_empty" && filter.value) {
      parts.set("filterValue", filter.value);
    }
  }
  const qs = parts.toString();
  return qs ? `?${qs}` : "";
}

function trendTitle(range: RangeState): string {
  if (range.preset === "7d") return "Responses per day · last 7 days";
  if (range.preset === "30d") return "Responses per day · last 30 days";
  if (range.preset === "custom" && range.from && range.to) {
    return `Responses per day · ${range.from} – ${range.to}`;
  }
  return "Responses per day · all time";
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function FormReportsPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();

  const [formTitle, setFormTitle] = useState("");
  const [range, setRange] = useState<RangeState>(DEFAULT_RANGE);
  const [filter, setFilter] = useState<FilterState>(null);

  const [report, setReport] = useState<FormReport | null>(null);
  const [loading, setLoading] = useState(true); // initial load only
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState(""); // fatal (no data to show)
  const [refetchError, setRefetchError] = useState(""); // transient (keep data)

  // Load the form title once (independent of the range/filter query).
  useEffect(() => {
    if (!formId) return;
    let active = true;
    void api
      .get<{ form: { title: string } }>(`/api/forms/${formId}`)
      .then((data) => {
        if (active) setFormTitle(data.form.title);
      })
      .catch(() => {
        /* title is non-critical; the report effect owns the error surface */
      });
    return () => {
      active = false;
    };
  }, [formId]);

  // A bumpable key so Retry can re-run the current query deterministically.
  const [reloadKey, setReloadKey] = useState(0);

  // Mirror whether data is on screen into a ref so the async catch can decide
  // between a fatal error (no data) and a non-destructive refetch banner.
  const hasDataRef = useRef(false);
  useEffect(() => {
    hasDataRef.current = report !== null;
  }, [report]);

  // Debounced + abortable report fetch. Keeps prior data visible while
  // refetching (never clears `report` on a range/filter change).
  const hasData = report !== null;
  useEffect(() => {
    if (!formId) {
      setError("Form ID is missing.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    // Preset changes feel instant; the debounce mainly protects custom-date and
    // filter-value typing. A single ~300ms delay for all changes is simple and
    // within the design's "~300ms" budget.
    const delay = 300;

    const query = buildReportQuery(range, filter);

    if (hasData) setIsRefetching(true);
    setRefetchError("");

    const timer = setTimeout(() => {
      void api
        .get<FormReport>(`/api/forms/${formId}/report${query}`, { signal: controller.signal })
        .then((data) => {
          setReport(data);
          setError("");
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return; // superseded
          const message =
            err instanceof ApiRequestError ? err.message : "Unable to load reports.";
          // If we already have data on screen, keep it and show an inline banner.
          if (hasDataRef.current) {
            setRefetchError(message);
          } else {
            setError(message);
          }
        })
        .finally(() => {
          setLoading(false);
          setIsRefetching(false);
        });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, range, filter, reloadKey]);

  const questions: ToolbarQuestion[] = useMemo(
    () => (report ? report.questions.map((q) => ({ id: q.questionId, label: q.label })) : []),
    [report],
  );

  function handleClearFilters() {
    setRange(DEFAULT_RANGE);
    setFilter(null);
  }

  // ── Initial load: skeletons ──
  if (loading && !report) {
    return <ReportsSkeleton title={formTitle} formId={formId} onBack={() => navigate("/dashboard")} />;
  }

  // ── Fatal error (no data to show) ──
  if (error && !report) {
    return (
      <main className="dashboard-shell">
        <ReportsHeader
          formTitle={formTitle}
          totalResponses={0}
          formId={formId}
          onBack={() => navigate("/dashboard")}
        />
        <section className="editor-card error-card" style={{ maxWidth: 980, margin: "0 auto" }}>
          <h2>Unable to load reports</h2>
          <p>{error}</p>
          <button type="button" className="primary-button" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (!report) return null; // unreachable once loaded, keeps TS narrow

  const { totalResponses, funnel, metrics, timeSeries, questions: questionReports } = report;
  const filterActive = report.filterApplied;
  const rangeActive = range.preset !== "all";
  const scopeCount = funnel.completions;
  const hasActivity = timeSeries.some((p) => p.views > 0 || p.submissions > 0);
  const isEmpty = funnel.views === 0 && funnel.starts === 0 && funnel.completions === 0;
  const unknownFilter = report.warnings.includes("UNKNOWN_FILTER_QUESTION");

  return (
    <main className="dashboard-shell">
      <ReportsHeader
        formTitle={formTitle}
        totalResponses={totalResponses}
        formId={formId}
        onBack={() => navigate("/dashboard")}
      />

      <ReportsToolbar
        range={range}
        filter={filter}
        questions={questions}
        scopeCount={scopeCount}
        onRangeChange={setRange}
        onFilterChange={setFilter}
      />

      {unknownFilter ? (
        <p className="toolbar-error" role="alert" style={{ maxWidth: 980, margin: "0 auto 12px" }}>
          That question no longer exists — the filter was cleared.
        </p>
      ) : null}

      {refetchError ? (
        <div className="inline-banner" role="alert" style={{ maxWidth: 980, margin: "0 auto 12px" }}>
          {refetchError}{" "}
          <button type="button" className="link-button" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      ) : null}

      {/* Thin top progress bar while refetching */}
      {isRefetching ? <div className="refetch-progress" aria-hidden="true" /> : null}

      <div className={isRefetching ? "dashboard-content is-refetching" : "dashboard-content"}>
        {isEmpty ? (
          <section className="editor-card empty-reports" style={{ maxWidth: 980, margin: "0 auto" }}>
            <h2>No responses in this range yet</h2>
            <p className="muted">Try widening the date range or clearing the filter.</p>
            {(filterActive || rangeActive) ? (
              <button type="button" className="primary-button" onClick={handleClearFilters}>
                Clear filters
              </button>
            ) : null}
          </section>
        ) : (
          <>
            <StatCards
              data={{
                views: funnel.views,
                starts: funnel.starts,
                completions: funnel.completions,
                completionRateViews: metrics.completionRateViews,
                completionRateStarts: metrics.completionRateStarts,
                avgTime: metrics.avgTime,
                filterActive,
                rangeActive,
              }}
            />

            <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
              <div className="editor-card-header">
                <div>
                  <p className="eyebrow">Funnel</p>
                  <h2>Views → Starts → Completions</h2>
                </div>
                {metrics.peakDay ? (
                  <div style={{ textAlign: "right" }}>
                    <span className="muted">Peak day</span>
                    <br />
                    <strong>{metrics.peakDay.date}</strong>{" "}
                    <span className="muted">({metrics.peakDay.count})</span>
                  </div>
                ) : null}
              </div>
              <FunnelChart data={funnel} />
            </section>

            {/* Responses-per-day trend */}
            {hasActivity ? (
              <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
                <div className="editor-card-header">
                  <div>
                    <p className="eyebrow">Activity</p>
                    <h2>{trendTitle(range)}</h2>
                  </div>
                </div>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timeSeries} margin={{ left: 0, right: 16, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(d: string) => d.slice(5)}
                        minTickGap={24}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="views" stroke="#2563eb" strokeWidth={2} dot={false} name="Views" />
                      <Line type="monotone" dataKey="submissions" stroke="#16a34a" strokeWidth={2} dot={false} name="Submissions" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* Visually-hidden data table mirrors the series for screen readers */}
                <table className="sr-only">
                  <caption>{trendTitle(range)}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Views</th>
                      <th scope="col">Submissions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeSeries.map((p) => (
                      <tr key={p.date}>
                        <th scope="row">{p.date}</th>
                        <td>{p.views}</td>
                        <td>{p.submissions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {/* Section completeness (multi-section only) */}
            {metrics.sectionCompleteness && metrics.sectionCompleteness.length > 0 ? (
              <SectionCompleteness sections={metrics.sectionCompleteness} />
            ) : null}

            {/* Per-question breakdowns over the (possibly filtered) response set */}
            {filterActive ? (
              <section className="editor-card question-section-head" style={{ maxWidth: 980, margin: "0 auto 10px" }}>
                <div className="editor-card-header">
                  <div>
                    <p className="eyebrow">Per-question breakdown</p>
                    <h2>
                      Questions <span className="filtered-ribbon">Filtered</span>
                    </h2>
                  </div>
                </div>
              </section>
            ) : null}

            {questionReports.map((question) => (
              <QuestionAnalytics key={question.questionId} report={question} />
            ))}

            {questionReports.length === 0 ? (
              <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
                <p className="empty-state">No questions to analyze.</p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

// ─── Header + skeleton ──────────────────────────────────────────────────────

function ReportsHeader({
  formTitle,
  totalResponses,
  formId,
  onBack,
}: {
  formTitle: string;
  totalResponses: number;
  formId: string | undefined;
  onBack: () => void;
}) {
  return (
    <header className="dashboard-header">
      <div>
        <button className="back-button" type="button" onClick={onBack}>
          ← Dashboard
        </button>
        <p className="eyebrow">Reports</p>
        <h1>{formTitle || "Reports"}</h1>
        <p className="muted">Analytics insights across {totalResponses} total responses.</p>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {formId ? (
          <>
            <Link className="secondary-link" to={`/forms/${formId}/responses`}>
              View responses
            </Link>
            <Link className="secondary-link" to={`/forms/${formId}/edit`}>
              Edit form
            </Link>
          </>
        ) : null}
      </div>
    </header>
  );
}

function ReportsSkeleton({
  title,
  formId,
  onBack,
}: {
  title: string;
  formId: string | undefined;
  onBack: () => void;
}) {
  return (
    <main className="dashboard-shell">
      <ReportsHeader formTitle={title} totalResponses={0} formId={formId} onBack={onBack} />
      <div style={{ maxWidth: 980, margin: "0 auto" }} aria-busy="true" aria-label="Loading reports">
        <section className="stat-hero" style={{ marginBottom: 18 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="stat-card">
              <div className="skeleton-block" style={{ width: "50%", marginBottom: 12 }} />
              <div className="skeleton-block" style={{ width: "70%", height: 28 }} />
            </div>
          ))}
        </section>
        <section className="editor-card" style={{ marginBottom: 18 }}>
          <div className="skeleton-block" style={{ width: "40%", marginBottom: 16 }} />
          <div className="skeleton-block" style={{ height: 28, marginBottom: 10 }} />
          <div className="skeleton-block" style={{ height: 28, width: "75%", marginBottom: 10 }} />
          <div className="skeleton-block" style={{ height: 28, width: "45%" }} />
        </section>
        <section className="editor-card">
          <div className="skeleton-block" style={{ width: "40%", marginBottom: 16 }} />
          <div className="skeleton-block" style={{ height: 200 }} />
        </section>
      </div>
    </main>
  );
}

// ─── Per-question charts (unchanged behavior; re-homed) ─────────────────────

function QuestionAnalytics({ report }: { report: QuestionReport }) {
  if (report.kind === "choice") return <ChoiceChart report={report} />;
  if (report.kind === "rating") return <RatingChart report={report} />;
  if (report.kind === "number") return <NumberSummary report={report} />;
  return <TextSummary report={report} />;
}

function CardHeader({ report, eyebrow }: { report: BaseReport; eyebrow?: string }) {
  return (
    <div className="editor-card-header">
      <div>
        <p className="eyebrow">{eyebrow ?? report.type.replace(/_/g, " ")}</p>
        <h2>{report.label}</h2>
      </div>
    </div>
  );
}

function ChoiceChart({ report }: { report: ChoiceReport }) {
  const chartData = report.options.map((o) => ({
    name: o.name.length > 25 ? o.name.slice(0, 22) + "..." : o.name,
    count: o.count,
    percentage: o.percentage,
  }));

  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <CardHeader report={report} />
      <p className="muted" style={{ marginBottom: 16 }}>
        {report.answered} answer{report.answered === 1 ? "" : "s"} · {report.skipped} skipped
      </p>

      {chartData.length > 0 ? (
        <div style={{ width: "100%", height: Math.max(200, chartData.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => [`${value} responses`, "Count"]} />
              <Bar dataKey="count" fill="#2563eb" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        {report.options.map((item, i) => (
          <div
            key={item.name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 0",
              borderBottom: i < report.options.length - 1 ? "1px solid #f1f5f9" : "none",
            }}
          >
            <span style={{ color: "#334155" }}>{item.name}</span>
            <span className="muted">
              {item.count} ({item.percentage}%)
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RatingChart({ report }: { report: RatingReport }) {
  const chartData = report.distribution.map((d) => ({
    rating: String(d.rating),
    count: d.count,
  }));

  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">Rating</p>
          <h2>{report.label}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="muted">Average</span>
          <br />
          <strong style={{ fontSize: "1.8rem", color: "#2563eb" }}>
            {report.average ?? "—"}
          </strong>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        {report.answered} answer{report.answered === 1 ? "" : "s"} · {report.skipped} skipped
      </p>

      {chartData.length > 0 ? (
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 0, right: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="rating" />
              <YAxis allowDecimals={false} />
              <Tooltip formatter={(value) => [`${value} responses`, "Count"]} />
              <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}

function NumberSummary({ report }: { report: NumberReport }) {
  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <CardHeader report={report} eyebrow="Number" />
      <p className="muted" style={{ marginBottom: 16 }}>
        {report.answered} answer{report.answered === 1 ? "" : "s"} · {report.skipped} skipped
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <span className="summary-label">Average</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{report.average ?? "—"}</strong>
        </div>
        <div>
          <span className="summary-label">Min</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{report.min ?? "—"}</strong>
        </div>
        <div>
          <span className="summary-label">Max</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{report.max ?? "—"}</strong>
        </div>
        <div>
          <span className="summary-label">Sum</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{report.sum}</strong>
        </div>
      </div>
    </section>
  );
}

function TextSummary({ report }: { report: TextReport }) {
  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <CardHeader report={report} />
      <p className="muted">
        {report.answered} answer{report.answered === 1 ? "" : "s"} · {report.skipped} skipped
      </p>
      {report.sample.length > 0 ? (
        <div style={{ maxHeight: 200, overflow: "auto", marginTop: 12 }}>
          {report.sample.map((answer, i) => (
            <div
              key={i}
              style={{
                padding: "8px 12px",
                background: i % 2 === 0 ? "#f8fafc" : "#fff",
                borderRadius: 8,
                marginBottom: 4,
                color: "#334155",
                fontSize: "0.92rem",
              }}
            >
              {renderSampleAnswer(answer)}
            </div>
          ))}
          {report.answered > report.sample.length ? (
            <p className="muted" style={{ marginTop: 8 }}>
              + {report.answered - report.sample.length} more responses
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
