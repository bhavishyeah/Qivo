import { useEffect, useMemo, useState } from "react";
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
import type { FormRecord, Question, ResponseRecord } from "../types";

export default function FormReportsPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
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
        const formData = await api.get<{ form: FormRecord }>(`/api/forms/${formId}`);
        setForm(formData.form);

        // Load all responses (paginate through)
        let allResponses: ResponseRecord[] = [];
        let cursor: string | undefined;
        let hasMore = true;

        while (hasMore) {
          const query = new URLSearchParams({ limit: "100" });
          if (cursor) query.set("cursor", cursor);

          const data = await api.get<{
            responses: ResponseRecord[];
            nextCursor?: string;
          }>(`/api/forms/${formId}/responses?${query.toString()}`);

          allResponses = [...allResponses, ...data.responses];

          if (data.nextCursor) {
            cursor = data.nextCursor;
          } else {
            hasMore = false;
          }

          // Safety limit
          if (allResponses.length > 5000) break;
        }

        setResponses(allResponses);
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

  const questions = useMemo(
    () => form?.schema?.sections?.flatMap((s) => s.questions) ?? [],
    [form],
  );

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading reports...</p>
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to load reports</h1>
          <p>{error || "Form not found."}</p>
        </div>
      </main>
    );
  }

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
          <h1>{form.title}</h1>
          <p className="muted">Analytics and insights from {responses.length} responses.</p>
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
          <strong>{responses.length}</strong>
        </div>
        <div>
          <span className="summary-label">Questions</span>
          <strong>{questions.length}</strong>
        </div>
      </section>

      {/* Per-question analytics */}
      {questions.map((question) => (
        <QuestionAnalytics
          key={question.id}
          question={question}
          responses={responses}
        />
      ))}

      {questions.length === 0 ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
          <p className="empty-state">No questions to analyze.</p>
        </section>
      ) : null}
    </main>
  );
}

function QuestionAnalytics({
  question,
  responses,
}: {
  question: Question;
  responses: ResponseRecord[];
}) {
  // Get all answers for this question
  const answers = responses
    .map((r) => r.answers[question.id])
    .filter((a) => a !== undefined && a !== null && a !== "");

  const totalAnswers = answers.length;
  const skipCount = responses.length - totalAnswers;

  // Choice-based questions → bar/pie chart
  if (
    question.type === "SINGLE_CHOICE" ||
    question.type === "MULTIPLE_CHOICE" ||
    question.type === "YES_NO"
  ) {
    return (
      <ChoiceChart
        question={question}
        answers={answers}
        totalResponses={responses.length}
        skipCount={skipCount}
      />
    );
  }

  // Rating → bar chart of distribution
  if (question.type === "RATING") {
    return (
      <RatingChart
        question={question}
        answers={answers}
        totalResponses={responses.length}
        skipCount={skipCount}
      />
    );
  }

  // Number → average + distribution
  if (question.type === "NUMBER") {
    return (
      <NumberSummary
        question={question}
        answers={answers}
        skipCount={skipCount}
      />
    );
  }

  // Text-based → show summary stats
  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">{question.type.replace(/_/g, " ")}</p>
          <h2>{question.label}</h2>
        </div>
      </div>
      <p className="muted">
        {totalAnswers} answer{totalAnswers === 1 ? "" : "s"} · {skipCount} skipped
      </p>
      {totalAnswers > 0 ? (
        <div style={{ maxHeight: 200, overflow: "auto", marginTop: 12 }}>
          {answers.slice(0, 20).map((answer, i) => (
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
              {String(answer)}
            </div>
          ))}
          {totalAnswers > 20 ? (
            <p className="muted" style={{ marginTop: 8 }}>
              + {totalAnswers - 20} more responses
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ChoiceChart({
  question,
  answers,
  skipCount,
}: {
  question: Question;
  answers: unknown[];
  totalResponses: number;
  skipCount: number;
}) {
  // Count occurrences
  const counts = new Map<string, number>();

  for (const answer of answers) {
    if (Array.isArray(answer)) {
      for (const item of answer) {
        counts.set(String(item), (counts.get(String(item)) ?? 0) + 1);
      }
    } else {
      const val = String(answer);
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
  }

  const chartData = Array.from(counts.entries())
    .map(([name, count]) => ({
      name: name.length > 25 ? name.slice(0, 22) + "..." : name,
      count,
      percentage: answers.length > 0 ? Math.round((count / answers.length) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">{question.type.replace(/_/g, " ")}</p>
          <h2>{question.label}</h2>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        {answers.length} answer{answers.length === 1 ? "" : "s"} · {skipCount} skipped
      </p>

      {chartData.length > 0 ? (
        <div style={{ width: "100%", height: Math.max(200, chartData.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => [`${value} responses`, "Count"]}
              />
              <Bar dataKey="count" fill="#2563eb" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* Also show as list */}
      <div style={{ marginTop: 16 }}>
        {chartData.map((item, i) => (
          <div
            key={item.name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "8px 0",
              borderBottom: i < chartData.length - 1 ? "1px solid #f1f5f9" : "none",
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

function RatingChart({
  question,
  answers,
  skipCount,
}: {
  question: Question;
  answers: unknown[];
  totalResponses: number;
  skipCount: number;
}) {
  const min = question.settings?.min ?? 1;
  const max = question.settings?.max ?? 5;

  const counts = new Map<number, number>();
  for (let i = min; i <= max; i++) counts.set(i, 0);

  let sum = 0;
  for (const answer of answers) {
    const num = Number(answer);
    if (!isNaN(num)) {
      counts.set(num, (counts.get(num) ?? 0) + 1);
      sum += num;
    }
  }

  const average = answers.length > 0 ? (sum / answers.length).toFixed(1) : "—";

  const chartData = Array.from(counts.entries()).map(([rating, count]) => ({
    rating: String(rating),
    count,
  }));

  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">Rating</p>
          <h2>{question.label}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="muted">Average</span>
          <br />
          <strong style={{ fontSize: "1.8rem", color: "#2563eb" }}>{average}</strong>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        {answers.length} answer{answers.length === 1 ? "" : "s"} · {skipCount} skipped
      </p>

      {chartData.length > 0 ? (
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 0, right: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="rating" />
              <YAxis allowDecimals={false} />
              <Tooltip
                formatter={(value) => [`${value} responses`, "Count"]}
              />
              <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </section>
  );
}

function NumberSummary({
  question,
  answers,
  skipCount,
}: {
  question: Question;
  answers: unknown[];
  skipCount: number;
}) {
  const numbers = answers.map(Number).filter((n) => !isNaN(n));
  const sum = numbers.reduce((a, b) => a + b, 0);
  const avg = numbers.length > 0 ? (sum / numbers.length).toFixed(1) : "—";
  const min = numbers.length > 0 ? Math.min(...numbers) : "—";
  const max = numbers.length > 0 ? Math.max(...numbers) : "—";

  return (
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 18px" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">Number</p>
          <h2>{question.label}</h2>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        {numbers.length} answer{numbers.length === 1 ? "" : "s"} · {skipCount} skipped
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <span className="summary-label">Average</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{avg}</strong>
        </div>
        <div>
          <span className="summary-label">Min</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{min}</strong>
        </div>
        <div>
          <span className="summary-label">Max</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{max}</strong>
        </div>
        <div>
          <span className="summary-label">Sum</span>
          <br />
          <strong style={{ fontSize: "1.4rem" }}>{sum}</strong>
        </div>
      </div>
    </section>
  );
}
