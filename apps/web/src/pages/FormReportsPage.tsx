import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api, ApiRequestError } from "../lib/api";

// ─── Report shapes (mirror the API's getFormReport output) ──────────────────

type QuestionType =
  | "SHORT_TEXT" | "LONG_TEXT" | "EMAIL" | "NUMBER" | "DATE"
  | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "RATING" | "YES_NO"
  | "PHONE" | "URL" | "FILE_UPLOAD" | "LINEAR_SCALE";

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

type FormReport = {
  totalResponses: number;
  analytics: { views: number; submissions: number; conversionRate: number };
  questions: QuestionReport[];
};

export default function FormReportsPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();

  const [formTitle, setFormTitle] = useState("");
  const [report, setReport] = useState<FormReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadData() {
      if (!formId) {
        setError("Form ID is missing.");
        setLoading(false);
        return;
      }

      try {
        // Form (for the title) + the server-aggregated report in parallel.
        const [formData, reportData] = await Promise.all([
          api.get<{ form: { title: string } }>(`/api/forms/${formId}`),
          api.get<FormReport>(`/api/forms/${formId}/report`),
        ]);
        setFormTitle(formData.form.title);
        setReport(reportData);
      } catch (err) {
        setError(
          err instanceof ApiRequestError ? err.message : "Unable to load reports.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, [formId]);

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading reports...</p>
        </div>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to load reports</h1>
          <p>{error || "Form not found."}</p>
        </div>
      </main>
    );
  }

  const { totalResponses, analytics, questions } = report;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <button
            className="back-button"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </button>
          <p className="eyebrow">Reports</p>
          <h1>{formTitle}</h1>
          <p className="muted">Analytics and insights from {totalResponses} responses.</p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="secondary-link" to={`/forms/${formId}/responses`}>
            View responses
          </Link>
          <Link className="secondary-link" to={`/forms/${formId}/edit`}>
            Edit form
          </Link>
        </div>
      </header>

      {/* Summary cards */}
      <section className="response-summary" style={{ maxWidth: 980, margin: "0 auto 24px" }}>
        <div>
          <span className="summary-label">Total responses</span>
          <strong>{totalResponses}</strong>
        </div>
        <div>
          <span className="summary-label">Views</span>
          <strong>{analytics.views}</strong>
        </div>
        <div>
          <span className="summary-label">Submissions</span>
          <strong>{analytics.submissions}</strong>
        </div>
        <div>
          <span className="summary-label">Conversion</span>
          <strong>{analytics.conversionRate}%</strong>
        </div>
        <div>
          <span className="summary-label">Questions</span>
          <strong>{questions.length}</strong>
        </div>
      </section>

      {/* Per-question analytics */}
      {questions.map((question) => (
        <QuestionAnalytics key={question.questionId} report={question} />
      ))}

      {questions.length === 0 ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
          <p className="empty-state">No questions to analyze.</p>
        </section>
      ) : null}
    </main>
  );
}

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
              {answer}
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
