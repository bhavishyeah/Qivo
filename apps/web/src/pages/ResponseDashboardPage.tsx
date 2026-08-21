import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord, Question, ResponseRecord } from "../types";

function formatResponseValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsvValue(value: unknown): string {
  const text = formatResponseValue(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadResponsesCsv(
  responses: ResponseRecord[],
  questions: Question[],
  formTitle: string,
) {
  const headers = ["Submitted at", "Email", ...questions.map((q) => q.label)];

  const rows = responses.map((response) => {
    const email =
      typeof response.metadata?.email === "string" ? response.metadata.email : "";
    return [
      response.submittedAt,
      email,
      ...questions.map((q) => formatResponseValue(response.answers[q.id])),
    ];
  });

  const csv = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${formTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-responses.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadResponsesExcel(
  responses: ResponseRecord[],
  questions: Question[],
  formTitle: string,
) {
  const headers = ["Submitted at", "Email", ...questions.map((q) => q.label)];

  const rows = responses.map((response) => {
    const email = typeof response.metadata?.email === "string" ? response.metadata.email : "";
    return [
      new Date(response.submittedAt).toLocaleString(),
      email,
      ...questions.map((q) => formatResponseValue(response.answers[q.id])),
    ];
  });

  const wsData = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Responses");

  XLSX.writeFile(wb, `${formTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-responses.xlsx`);
}

export default function ResponseDashboardPage() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [responses, setResponses] = useState<ResponseRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<ResponseRecord | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Derive questions from form state (fixed — was using form before declaration)
  const questions =
    form?.schema?.sections?.flatMap((section) => section.questions) ?? [];

  async function loadResponses(cursor?: string) {
    if (!formId) {
      setError("A form ID is missing.");
      setLoading(false);
      return;
    }

    const isNextPage = cursor !== undefined;
    if (isNextPage) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      const query = new URLSearchParams({ limit: "20" });
      if (cursor) query.set("cursor", cursor);

      const [formData, responsesData] = await Promise.all([
        form
          ? Promise.resolve(null)
          : api.get<{ form: FormRecord }>(`/api/forms/${formId}`),
        api.get<{ responses: ResponseRecord[]; nextCursor?: string }>(
          `/api/forms/${formId}/responses?${query.toString()}`,
        ),
      ]);

      if (formData) {
        setForm(formData.form);
        // Fetch total count alongside form load
        api.get<{ count: number }>(`/api/forms/${formId}/responses-count`)
          .then((data) => setTotalCount(data.count))
          .catch(() => { /* non-critical */ });
      }
      setResponses(responsesData.responses);
      setNextCursor(responsesData.nextCursor ?? null);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to load responses.",
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadResponses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  async function openResponse(responseId: string) {
    if (!formId) return;

    try {
      const data = await api.get<{ response: ResponseRecord }>(
        `/api/forms/${formId}/responses/${responseId}`,
      );
      setSelectedResponse(data.response);
    } catch (err) {
      setError(
        err instanceof ApiRequestError ? err.message : "Unable to load response.",
      );
    }
  }

  async function goNext() {
    if (!nextCursor) return;
    setCursorHistory((current) => [...current, nextCursor]);
    await loadResponses(nextCursor);
  }

  async function goPrevious() {
    if (cursorHistory.length === 0) return;
    const previousHistory = cursorHistory.slice(0, -1);
    const previousCursor =
      previousHistory.length > 0
        ? previousHistory[previousHistory.length - 1]
        : undefined;
    setCursorHistory(previousHistory);
    await loadResponses(previousCursor);
  }

  async function deleteResponse(responseId: string) {
    if (!formId) return;
    setDeletingId(responseId);
    try {
      await api.delete(`/api/forms/${formId}/responses/${responseId}`);
      setResponses((current) => current.filter((r) => r.id !== responseId));
      setTotalCount((c) => (c !== null ? c - 1 : c));
      if (selectedResponse?.id === responseId) setSelectedResponse(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to delete response.");
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading responses...</p>
        </div>
      </main>
    );
  }

  if (error && !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to load responses</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="responses-shell">
      <header className="responses-header">
        <div>
          <button
            className="back-button"
            type="button"
            onClick={() => navigate("/dashboard")}
          >
            ← Dashboard
          </button>
          <p className="eyebrow">Responses</p>
          <h1>{form?.title ?? "Form responses"}</h1>
          <p className="muted">Review submissions collected from this form.</p>
        </div>

        <div className="responses-header-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={responses.length === 0}
            onClick={() =>
              downloadResponsesCsv(responses, questions, form?.title ?? "form")
            }
          >
            CSV
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={responses.length === 0}
            onClick={() =>
              downloadResponsesExcel(responses, questions, form?.title ?? "form")
            }
          >
            Excel
          </button>
          <Link className="secondary-link" to={`/forms/${formId}/reports`}>
            Reports
          </Link>
          <Link className="secondary-link" to={`/forms/${formId}/edit`}>
            Edit form
          </Link>
        </div>
      </header>

      {error ? (
        <p className="submit-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="response-summary">
        <div>
          <span className="summary-label">Total responses</span>
          <strong>{totalCount ?? "—"}</strong>
        </div>
        <div>
          <span className="summary-label">Showing</span>
          <strong>{responses.length}</strong>
        </div>
        <div>
          <span className="summary-label">Page</span>
          <strong>{cursorHistory.length + 1}</strong>
        </div>
      </section>

      <section className="responses-card">
        {responses.length === 0 ? (
          <div className="empty-dashboard">
            <p className="eyebrow">No responses yet</p>
            <h2>Share your form to collect responses.</h2>
            <p className="muted">Submitted responses will appear here.</p>
          </div>
        ) : (
          <div className="response-list">
            {responses.map((response) => (
              <div
                key={response.id}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <button
                  className="response-row"
                  type="button"
                  style={{ flex: 1 }}
                  onClick={() => void openResponse(response.id)}
                >
                  <span>
                    <strong>
                      {new Date(response.submittedAt).toLocaleString()}
                    </strong>
                    <small>{response.id}</small>
                  </span>
                  <span className="response-arrow">View →</span>
                </button>
                <button
                  type="button"
                  className="danger-button"
                  style={{ flexShrink: 0, padding: "8px 10px", fontSize: "0.78rem" }}
                  disabled={deletingId === response.id}
                  onClick={() => void deleteResponse(response.id)}
                  title="Delete response"
                >
                  {deletingId === response.id ? "..." : "Delete"}
                </button>
              </div>
            ))}
          </div>
        )}

        <nav className="pagination-controls" aria-label="Response pagination">
          <button
            className="secondary-button compact"
            type="button"
            disabled={cursorHistory.length === 0 || loadingMore}
            onClick={() => void goPrevious()}
          >
            Previous
          </button>
          <span className="muted">Page {cursorHistory.length + 1}</span>
          <button
            className="secondary-button compact"
            type="button"
            disabled={!nextCursor || loadingMore}
            onClick={() => void goNext()}
          >
            {loadingMore ? "Loading..." : "Next"}
          </button>
        </nav>
      </section>

      {selectedResponse ? (
        <ResponseDetail
          response={selectedResponse}
          questions={questions}
          onClose={() => setSelectedResponse(null)}
        />
      ) : null}
    </main>
  );
}

function ResponseDetail({
  response,
  questions,
  onClose,
}: {
  response: ResponseRecord;
  questions: Question[];
  onClose: () => void;
}) {
  const questionLabels = new Map(questions.map((q) => [q.id, q.label]));
  const answerEntries = Object.entries(response.answers);

  return (
    <div className="response-overlay" role="presentation" onClick={onClose}>
      <section
        className="response-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="response-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="response-detail-header">
          <div>
            <p className="eyebrow">Response detail</p>
            <h2 id="response-detail-title">
              Submitted {new Date(response.submittedAt).toLocaleString()}
            </h2>
            {typeof response.metadata?.email === "string" ? (
              <p className="muted">{response.metadata.email}</p>
            ) : null}
          </div>
          <button
            className="close-button"
            type="button"
            onClick={onClose}
            aria-label="Close response detail"
          >
            ×
          </button>
        </div>

        <div className="answer-list">
          {answerEntries.map(([questionId, answer]) => (
            <div className="answer-item" key={questionId}>
              <span className="answer-question-label">
                {questionLabels.get(questionId) ?? questionId}
              </span>
              <strong>{formatResponseValue(answer)}</strong>
            </div>
          ))}
        </div>

        {response.metadata ? (
          <div className="metadata-block">
            <p className="eyebrow">Metadata</p>
            <pre>{JSON.stringify(response.metadata, null, 2)}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}
