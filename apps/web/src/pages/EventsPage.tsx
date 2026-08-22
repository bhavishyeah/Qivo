import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";

type EventRecord = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  _count: { forms: number };
};

type EventForm = {
  id: string;
  title: string;
  slug: string;
  status: string;
  _count: { responses: number };
};

type EventDetail = EventRecord & { forms: EventForm[] };

export default function EventsPage() {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [creating, setCreating] = useState(false);

  // Detail view
  const [selectedEvent, setSelectedEvent] = useState<EventDetail | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const wsData = await api.get<{ workspaces: WorkspaceRecord[] }>("/api/workspaces");
      const ws = wsData.workspaces.find((w) => w.type === "PERSONAL") ?? wsData.workspaces[0];
      if (!ws) { setError("No workspace found."); setLoading(false); return; }
      setWorkspaceId(ws.id);
      const data = await api.get<{ events: EventRecord[] }>(`/api/events?workspaceId=${encodeURIComponent(ws.id)}`);
      setEvents(data.events);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load events.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim() || !workspaceId) return;
    setCreating(true); setError(""); setMessage("");
    try {
      await api.post("/api/events", {
        workspaceId,
        name: newName.trim(),
        ...(newDesc.trim() ? { description: newDesc.trim() } : {}),
        ...(newStart ? { startDate: newStart } : {}),
        ...(newEnd ? { endDate: newEnd } : {}),
      });
      setNewName(""); setNewDesc(""); setNewStart(""); setNewEnd("");
      setShowCreate(false);
      setMessage("Event created.");
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to create event.");
    } finally {
      setCreating(false);
    }
  }

  async function openEvent(eventId: string) {
    try {
      const data = await api.get<{ event: EventDetail }>(`/api/events/${eventId}`);
      setSelectedEvent(data.event);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load event.");
    }
  }

  async function deleteEvent(eventId: string) {
    if (!confirm("Delete this event? Forms will not be deleted.")) return;
    try {
      await api.delete(`/api/events/${eventId}`);
      setMessage("Event deleted.");
      setSelectedEvent(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to delete event.");
    }
  }

  if (loading) {
    return (
      <main className="dashboard-shell">
        <div style={{ maxWidth: 980, margin: "0 auto" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card" style={{ marginBottom: 16 }}>
              <div className="skeleton-block" style={{ width: "50%", height: 22, marginBottom: 10 }} />
              <div className="skeleton-block" style={{ width: "30%", height: 14 }} />
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (selectedEvent) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <button className="back-button" type="button" onClick={() => setSelectedEvent(null)}>← Back to events</button>
            <p className="eyebrow">Event</p>
            <h1>{selectedEvent.name}</h1>
            {selectedEvent.description ? <p className="muted">{selectedEvent.description}</p> : null}
            {selectedEvent.startDate || selectedEvent.endDate ? (
              <p className="muted" style={{ fontSize: "0.82rem" }}>
                {selectedEvent.startDate ? `Starts: ${new Date(selectedEvent.startDate).toLocaleDateString()}` : ""}
                {selectedEvent.startDate && selectedEvent.endDate ? " · " : ""}
                {selectedEvent.endDate ? `Ends: ${new Date(selectedEvent.endDate).toLocaleDateString()}` : ""}
              </p>
            ) : null}
          </div>
          <button className="danger-button" type="button" onClick={() => void deleteEvent(selectedEvent.id)}>Delete event</button>
        </header>

        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
          <div className="editor-card-header">
            <div><p className="eyebrow">Forms</p><h2>{selectedEvent.forms.length} forms in this event</h2></div>
          </div>

          {selectedEvent.forms.length === 0 ? (
            <p className="muted" style={{ padding: "16px 0" }}>No forms added to this event yet. Add forms from the form editor.</p>
          ) : (
            <div className="editor-question-list">
              {selectedEvent.forms.map((form) => (
                <div key={form.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#f8fafc", borderRadius: 12, border: "1px solid #e2e8f0" }}>
                  <div>
                    <strong style={{ color: "#111827" }}>{form.title}</strong>
                    <span className={`status-pill status-${form.status.toLowerCase()}`} style={{ marginLeft: 10 }}>{form.status}</span>
                    <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>{form._count.responses} responses</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Link className="secondary-button compact" to={`/forms/${form.id}/edit`}>Edit</Link>
                    <Link className="secondary-button compact" to={`/forms/${form.id}/responses`}>Responses</Link>
                    {form.status === "PUBLISHED" ? (
                      <a className="secondary-button compact" href={`/f/${form.slug}`} target="_blank" rel="noopener noreferrer">Open ↗</a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Events</p>
          <h1>Event mode</h1>
          <p className="muted">Group multiple forms under one event (e.g. Orientation 2026).</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => setShowCreate((v) => !v)} style={{ background: "#2563eb", color: "#fff", border: "none" }}>
          {showCreate ? "Cancel" : "+ New event"}
        </button>
      </header>

      {message ? <p className="editor-message" role="status" style={{ maxWidth: 980, margin: "0 auto 18px" }}>{message}</p> : null}
      {error ? <p className="submit-error" role="alert" style={{ maxWidth: 980, margin: "0 auto 18px" }}>{error}</p> : null}

      {showCreate ? (
        <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto 20px", background: "#eff6ff", border: "1px solid #bfdbfe" }}>
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 14 }}>
            <div className="question-field">
              <label>Event name</label>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Orientation 2026" required autoFocus style={{ width: "100%", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 12px" }} />
            </div>
            <div className="question-field">
              <label>Description (optional)</label>
              <textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} placeholder="What is this event about?" style={{ width: "100%", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 12px" }} />
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div className="question-field" style={{ flex: 1, minWidth: 200 }}>
                <label>Start date (optional)</label>
                <input type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} style={{ width: "100%", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 12px" }} />
              </div>
              <div className="question-field" style={{ flex: 1, minWidth: 200 }}>
                <label>End date (optional)</label>
                <input type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} style={{ width: "100%", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 12px" }} />
              </div>
            </div>
            <button className="secondary-button" type="submit" disabled={creating || !newName.trim()}>{creating ? "Creating..." : "Create event"}</button>
          </form>
        </section>
      ) : null}

      <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
        {events.length === 0 ? (
          <div className="empty-state" style={{ padding: "40px 0", textAlign: "center" }}>
            <p style={{ fontSize: "2rem", margin: "0 0 12px" }}>🎪</p>
            <h2>No events yet</h2>
            <p className="muted">Create an event to group related forms together.</p>
          </div>
        ) : (
          <div className="editor-question-list">
            {events.map((event) => (
              <button key={event.id} type="button" className="response-row" onClick={() => void openEvent(event.id)}>
                <span>
                  <strong style={{ color: "#111827" }}>{event.name}</strong>
                  <small style={{ display: "block", marginTop: 4, color: "#64748b" }}>
                    {event._count.forms} form{event._count.forms !== 1 ? "s" : ""}
                    {event.startDate ? ` · ${new Date(event.startDate).toLocaleDateString()}` : ""}
                  </small>
                </span>
                <span className="response-arrow">View →</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
