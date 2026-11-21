import { useCallback, useEffect, useState } from "react";
import { api, ApiRequestError } from "../lib/api";
import { REPORT_REASONS } from "../lib/reportForm";
import "../styles/admin-reports.css";

export type AdminReport = {
  id: string;
  reason: "SCAM" | "SPAM" | "IMPERSONATION" | "OTHER";
  details: string | null;
  reporterEmail: string | null;
  status: "OPEN" | "REVIEWED" | "DISMISSED";
  createdAt: string;
  reportCount: number;
  form: {
    id: string;
    title: string;
    slug: string;
    status: string;
    flaggedAt: string | null;
    ownerEmail: string;
  };
};

type ReportsPage = { reports: AdminReport[]; total: number; page: number; pageSize: number };
type StatusFilter = "OPEN" | "REVIEWED" | "DISMISSED";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "DISMISSED", label: "Dismissed" },
];
const PAGE_SIZE = 20;

function reasonLabel(reason: AdminReport["reason"]): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export function ReportsTable({
  reports,
  busyId,
  onSetStatus,
}: {
  reports: AdminReport[];
  busyId: string | null;
  onSetStatus: (id: string, status: StatusFilter) => void;
}) {
  if (reports.length === 0) return <p className="text-muted">No reports here.</p>;
  return (
    <div className="admin-reports-scroll">
      <table className="admin-reports-table">
        <thead>
          <tr>
            <th scope="col">Form</th>
            <th scope="col">Reason</th>
            <th scope="col">Reports</th>
            <th scope="col">Latest</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.form.title}</strong>
                {r.form.flaggedAt ? <span className="badge badge-status-closed"> Flagged</span> : null}
                <div className="text-subtle">{r.form.ownerEmail}</div>
              </td>
              <td>
                {reasonLabel(r.reason)}
                {r.details ? <div className="text-subtle admin-reports-details">{r.details}</div> : null}
              </td>
              <td>{r.reportCount}</td>
              <td>{new Date(r.createdAt).toLocaleDateString()}</td>
              <td>{r.status.charAt(0) + r.status.slice(1).toLowerCase()}</td>
              <td>
                <div className="admin-reports-actions">
                  {r.status !== "REVIEWED" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === r.id}
                      onClick={() => onSetStatus(r.id, "REVIEWED")}
                    >
                      Mark reviewed
                    </button>
                  ) : null}
                  {r.status !== "DISMISSED" ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === r.id}
                      onClick={() => onSetStatus(r.id, "DISMISSED")}
                    >
                      Dismiss
                    </button>
                  ) : null}
                  <a
                    className="secondary-button"
                    href={`/f/${encodeURIComponent(r.form.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open form
                  </a>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Platform-admin report queue. Renders nothing for accounts without access and until the first access check resolves. */
export default function AdminReports() {
  const [filter, setFilter] = useState<StatusFilter>("OPEN");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportsPage | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get<ReportsPage>(
        `/api/admin/reports?status=${filter}&page=${page}&pageSize=${PAGE_SIZE}`,
      );
      setData(result);
      setError("");
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "FORBIDDEN") {
        setAllowed(false);
        return;
      }
      setError(err instanceof ApiRequestError ? err.message : "Unable to load reports.");
    }
  }, [filter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and when the filter or page changes
    void load();
  }, [load]);

  async function setStatus(id: string, status: StatusFilter) {
    setBusyId(id);
    try {
      await api.patch(`/api/admin/reports/${encodeURIComponent(id)}`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to update the report.");
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) return null;
  // Hide the moderation chrome until the first access check resolves, so
  // non-admins never see the reports section (not even a loading flash).
  if (!data && !error) return null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="panel" aria-labelledby="admin-reports-heading">
      <div className="panel-head">
        <div>
          <p className="dash-kicker">Moderation</p>
          <h2 id="admin-reports-heading">Reports</h2>
        </div>
        <div className="admin-reports-filters" role="group" aria-label="Report status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={f.value === filter ? "primary-button" : "secondary-button"}
              aria-pressed={f.value === filter}
              onClick={() => {
                setFilter(f.value);
                setPage(1);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="msg msg-error" role="alert">{error}</p> : null}
      {data ? <ReportsTable reports={data.reports} busyId={busyId} onSetStatus={(id, s) => void setStatus(id, s)} /> : <p className="text-muted">Loading reports...</p>}
      {data && pages > 1 ? (
        <div className="admin-reports-pager">
          <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="text-subtle">Page {page} of {pages}</span>
          <button type="button" className="secondary-button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}