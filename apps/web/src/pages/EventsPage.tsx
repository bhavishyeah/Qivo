import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiRequestError } from "../lib/api";
import type { WorkspaceRecord } from "../types";
import { PageIcon } from "../components/PageIcons";

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

type EventDetail = EventRecord & { forms: EventForm[]; workspaceId: string };

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "published":
      return "badge badge-status-published";
    case "pending_review":
      return "badge badge-status-pending";
    case "closed":
      return "badge badge-status-closed";
    case "archived":
      return "badge badge-status-archived";
    default:
      return "badge badge-status-draft";
  }
}

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
        <div className="page-col" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-tile" style={{ marginBottom: 16 }}>
              <div className="skeleton-line skeleton-line-lg" style={{ width: "50%" }} />
              <div className="skeleton-line" style={{ width: "30%" }} />
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
            <button className="back-link" type="button" onClick={() => setSelectedEvent(null)}>{"\u2190"} Back to events</button>
            <p className="dash-kicker">Event</p>
            <h1>{selectedEvent.name}</h1>
            {selectedEvent.description ? <p className="page-sub">{selectedEvent.description}</p> : null}
            {selectedEvent.startDate || selectedEvent.endDate ? (
              <p className="text-subtle">
                {selectedEvent.startDate ? `Starts: ${new Date(selectedEvent.startDate).toLocaleDateString()}` : ""}
                {selectedEvent.startDate && selectedEvent.endDate ? " \u00B7 " : ""}
                {selectedEvent.endDate ? `Ends: ${new Date(selectedEvent.endDate).toLocaleDateString()}` : ""}
              </p>
            ) : null}
          </div>
          <button className="btn btn-danger" type="button" onClick={() => void deleteEvent(selectedEvent.id)}>Delete event</button>
        </header>

        {message ? <p className="msg msg-ok page-col" role="status">{message}</p> : null}
        {error ? <p className="msg msg-error page-col" role="alert">{error}</p> : null}

        <section className="panel page-col">
          <div className="panel-head">
            <div><p className="dash-kicker">Forms</p><h2>{selectedEvent.forms.length} forms in this event</h2></div>
            <AddFormToEvent eventId={selectedEvent.id} workspaceId={selectedEvent.workspaceId} existingFormIds={selectedEvent.forms.map((f) => f.id)} onAdded={() => void openEvent(selectedEvent.id)} />
          </div>
          {selectedEvent.forms.length === 0 ? (
            <p className="text-muted">No forms yet. Click "Add form" above to link forms to this event.</p>
          ) : (
            <div className="row-list">
              {selectedEvent.forms.map((form) => (
                <div key={form.id} className="row-item">
                  <div className="row-main">
                    <strong className="row-title">{form.title}</strong>
                    <span className={statusBadgeClass(form.status)}>{form.status.replace(/_/g, " ")}</span>
                    <span className="row-meta">{form._count.responses} responses</span>
                  </div>
                  <div className="row-actions">
                    <Link className="btn btn-secondary btn-sm" to={`/forms/${form.id}/edit`}>Edit</Link>
                    <Link className="btn btn-secondary btn-sm" to={`/forms/${form.id}/responses`}>Responses</Link>
                    {form.status === "PUBLISHED" ? (
                      <a className="btn btn-secondary btn-sm" href={`/f/${form.slug}`} target="_blank" rel="noopener noreferrer">Open {"\u2197"}</a>
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
          <p className="dash-kicker">Events</p>
          <h1>Event mode</h1>
          <p className="page-sub">Group multiple forms under one event (e.g. Orientation 2026).</p>
        </div>
        <button className={`btn ${showCreate ? "btn-secondary" : "btn-primary"}`} type="button" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "+ New event"}
        </button>
      </header>

      {message ? <p className="msg msg-ok page-col" role="status">{message}</p> : null}
      {error ? <p className="msg msg-error page-col" role="alert">{error}</p> : null}

      {showCreate ? (
        <section className="panel panel-tint page-col">
          <form onSubmit={handleCreate} className="form-stack">
            <div className="field">
              <label className="field-label" htmlFor="event-name">Event name</label>
              <input id="event-name" className="input" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Orientation 2026" required autoFocus />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="event-desc">Description (optional)</label>
              <textarea id="event-desc" className="input" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} placeholder="What is this event about?" />
            </div>
            <div className="field-row">
              <div className="field">
                <label className="field-label" htmlFor="event-start">Start date (optional)</label>
                <input id="event-start" className="input" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="event-end">End date (optional)</label>
                <input id="event-end" className="input" type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
            </div>
            <div>
              <button className="btn btn-primary" type="submit" disabled={creating || !newName.trim()}>{creating ? "Creating..." : "Create event"}</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel page-col">
        {events.length === 0 ? (
          <div className="panel-empty">
            <h2>No events yet</h2>
            <p>Create an event to group related forms together.</p>
          </div>
        ) : (
          <div className="row-list">
            {events.map((event) => (
              <button key={event.id} type="button" className="row-item" onClick={() => void openEvent(event.id)}>
                <span className="row-main">
                  <strong className="row-title">{event.name}</strong>
                  <small className="row-meta">
                    {event._count.forms} form{event._count.forms !== 1 ? "s" : ""}
                    {event.startDate ? ` \u00B7 ${new Date(event.startDate).toLocaleDateString()}` : ""}
                  </small>
                </span>
                <span className="row-link">View {"\u2192"}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function AddFormToEvent({ eventId, workspaceId, existingFormIds, onAdded }: { eventId: string; workspaceId: string; existingFormIds: string[]; onAdded: () => void }) {
  const [showPicker, setShowPicker] = useState(false);
  const [forms, setForms] = useState<{ id: string; title: string }[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);

  async function loadForms() {
    setLoadingForms(true);
    try {
      const data = await api.get<{ forms: { id: string; title: string }[] }>(`/api/forms?workspaceId=${encodeURIComponent(workspaceId)}`);
      setForms(data.forms.filter((f) => !existingFormIds.includes(f.id)));
    } catch { /* silent */ }
    finally { setLoadingForms(false); }
  }

  async function addForm(formId: string) {
    try {
      await api.post(`/api/events/${eventId}/forms`, { formId });
      setShowPicker(false);
      onAdded();
    } catch { /* silent */ }
  }

  function handleOpen() {
    setShowPicker(true);
    void loadForms();
  }

  if (!showPicker) {
    return <button className="btn btn-secondary btn-sm" type="button" onClick={handleOpen}>+ Add form</button>;
  }

  return (
    <div className="picker-wrap">
      <div className="picker">
        <div className="picker-head">
          <span>Select a form</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => setShowPicker(false)}><PageIcon name="close" /></button>
        </div>
        {loadingForms ? <p className="picker-note">Loading...</p> : null}
        {!loadingForms && forms.length === 0 ? <p className="picker-note">No available forms to add.</p> : null}
        {forms.map((form) => (
          <button key={form.id} type="button" className="picker-item" onClick={() => void addForm(form.id)}>
            {form.title}
          </button>
        ))}
      </div>
    </div>
  );
}
