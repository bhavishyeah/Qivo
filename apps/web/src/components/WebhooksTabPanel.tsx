import { useCallback, useEffect, useState } from "react";

import { api, ApiRequestError } from "../lib/api";
import type { Webhook, WebhookDelivery } from "../types";

/**
 * Webhooks management panel for the form editor. Lets an editor add webhook
 * endpoints (URL + optional description), toggle enabled/disabled, view/copy
 * and regenerate the signing secret, delete a webhook, and inspect recent
 * delivery attempts. Uses the existing `api` client and editor CSS classes.
 */

const STATUS_LABELS: Record<WebhookDelivery["status"], string> = {
  pending: "Pending",
  delivered: "Delivered",
  failed: "Failed",
  exhausted: "Exhausted",
};

/** Friendly labels for each subscribable webhook event. */
const EVENT_LABELS: Record<string, string> = {
  "response.created": "New response",
  "form.published": "Form published",
  "form.closed": "Form closed",
};

/** The events a user can subscribe a webhook to, in display order. */
const EVENT_OPTIONS = [
  "response.created",
  "form.published",
  "form.closed",
] as const;

/** One-line hint shown under each event option. */
const EVENT_HINTS: Record<(typeof EVENT_OPTIONS)[number], string> = {
  "response.created": "Each time someone submits the form.",
  "form.published": "When the form goes live.",
  "form.closed": "When the form stops accepting responses.",
};

function statusBadgeStyle(status: WebhookDelivery["status"]): React.CSSProperties {
  const palette: Record<WebhookDelivery["status"], { bg: string; fg: string }> = {
    delivered: { bg: "var(--color-success-tint)", fg: "var(--color-success-text)" },
    pending: { bg: "var(--color-warning-tint)", fg: "var(--color-warning-text)" },
    failed: { bg: "var(--color-danger-tint)", fg: "var(--color-danger-text)" },
    exhausted: { bg: "var(--status-draft-bg)", fg: "var(--status-draft-fg)" },
  };
  const { bg, fg } = palette[status];
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: bg,
    color: fg,
  };
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export default function WebhooksTabPanel({ formId }: { formId: string }) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Add-form state
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(["response.created"]);
  const [adding, setAdding] = useState(false);

  function toggleEvent(event: string) {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ webhooks: Webhook[] }>(`/api/forms/${formId}/webhooks`);
      setWebhooks(data.webhooks);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to load webhooks.");
    } finally {
      setLoading(false);
    }
  }, [formId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount/dependency change; setState happens after await
    void load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!url.trim()) {
      setError("A webhook URL is required.");
      return;
    }
    setAdding(true);
    try {
      const chosenEvents = events.length > 0 ? events : ["response.created"];
      const data = await api.post<{ webhook: Webhook }>(`/api/forms/${formId}/webhooks`, {
        url: url.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        events: chosenEvents,
      });
      setWebhooks((prev) => [...prev, data.webhook]);
      setUrl("");
      setDescription("");
      setEvents(["response.created"]);
      setMessage("Webhook added.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to add webhook.");
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(webhook: Webhook) {
    setError("");
    setMessage("");
    try {
      const data = await api.patch<{ webhook: Webhook }>(
        `/api/forms/${formId}/webhooks/${webhook.id}`,
        { enabled: !webhook.enabled },
      );
      setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? data.webhook : w)));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to update webhook.");
    }
  }

  async function handleRegenerate(webhookId: string) {
    setError("");
    setMessage("");
    try {
      const data = await api.post<{ webhook: Webhook }>(
        `/api/forms/${formId}/webhooks/${webhookId}/regenerate-secret`,
      );
      setWebhooks((prev) => prev.map((w) => (w.id === webhookId ? data.webhook : w)));
      setMessage("Signing secret regenerated. Update your receiver.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to regenerate secret.");
    }
  }

  async function handleDelete(webhookId: string) {
    setError("");
    setMessage("");
    try {
      await api.delete(`/api/forms/${formId}/webhooks/${webhookId}`);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
      setMessage("Webhook deleted.");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Unable to delete webhook.");
    }
  }

  async function handleCopy(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setMessage("Secret copied to clipboard.");
    } catch {
      setError("Unable to copy to clipboard.");
    }
  }

  return (
    <section className="editor-card wh-card">
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">Webhooks</p>
          <h2>Outbound webhooks</h2>
        </div>
      </div>

      <p className="wh-intro">
        Qivo POSTs each new response to the endpoints you configure here. Every request is signed with the
        webhook&apos;s secret so your receiver can verify it. Failed deliveries retry automatically with backoff.
      </p>
      <code className="wh-signature">X-Qivo-Signature: sha256=&lt;hex&gt;</code>

      {error ? <p className="submit-error" role="alert">{error}</p> : null}
      {message ? <p className="wh-note is-success" role="status">{message}</p> : null}

      {/* Add webhook */}
      <form className="wh-form" onSubmit={handleAdd}>
        <div className="field">
          <label className="field-label" htmlFor="wh-url">Endpoint URL</label>
          <input
            id="wh-url"
            className="input wh-mono"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/qivo"
            required
          />
          <p className="field-help">Qivo sends a signed POST request to this URL.</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="wh-desc">
            Description <span className="muted">(optional)</span>
          </label>
          <input
            id="wh-desc"
            className="input"
            type="text"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Zapier intake"
          />
        </div>
        <fieldset className="wh-events">
          <legend className="field-label">Events</legend>
          {EVENT_OPTIONS.map((event) => (
            <label key={event} className="wh-event">
              <input
                className="check"
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggleEvent(event)}
              />
              <span className="wh-event-text">
                <span className="wh-event-title">{EVENT_LABELS[event]}</span>
                <span className="wh-event-hint">{EVENT_HINTS[event]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="wh-form-actions">
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? "Adding..." : "Add webhook"}
          </button>
        </div>
      </form>

      {/* List */}
      <h3 className="wh-list-title">Your webhooks</h3>
      {loading ? (
        <p className="field-help">Loading webhooks...</p>
      ) : webhooks.length === 0 ? (
        <div className="wh-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.14 1.14" />
            <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.13-1.13" />
          </svg>
          <p>No webhooks yet. Add one above.</p>
        </div>
      ) : (
        <div className="wh-list">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              formId={formId}
              webhook={webhook}
              onToggle={() => void handleToggle(webhook)}
              onRegenerate={() => void handleRegenerate(webhook.id)}
              onDelete={() => void handleDelete(webhook.id)}
              onCopy={() => void handleCopy(webhook.secret)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WebhookRow({
  formId,
  webhook,
  onToggle,
  onRegenerate,
  onDelete,
  onCopy,
}: {
  formId: string;
  webhook: Webhook;
  onToggle: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [deliveriesError, setDeliveriesError] = useState("");

  async function toggleDeliveries() {
    const next = !showDeliveries;
    setShowDeliveries(next);
    if (next) {
      setLoadingDeliveries(true);
      setDeliveriesError("");
      try {
        const data = await api.get<{ deliveries: WebhookDelivery[] }>(
          `/api/forms/${formId}/webhooks/${webhook.id}/deliveries?limit=20`,
        );
        setDeliveries(data.deliveries);
      } catch (err) {
        setDeliveriesError(
          err instanceof ApiRequestError ? err.message : "Unable to load deliveries.",
        );
      } finally {
        setLoadingDeliveries(false);
      }
    }
  }

  return (
    <div className="wh-item">
      <div className="wh-item-head">
        <div className="wh-item-main">
          <p className="wh-item-url">{webhook.url}</p>
          {webhook.description ? <p className="wh-item-desc">{webhook.description}</p> : null}
          <div className="wh-chips">
            {webhook.events.length > 0 ? (
              webhook.events.map((e) => (
                <span key={e} className="badge">{EVENT_LABELS[e] ?? e}</span>
              ))
            ) : (
              <span className="badge">No events</span>
            )}
          </div>
        </div>
        <label className="wh-switch">
          <input className="switch" type="checkbox" checked={webhook.enabled} onChange={onToggle} />
          <span>{webhook.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      {/* Secret */}
      <div className="wh-secret">
        <span className="field-label">Signing secret</span>
        <div className="wh-secret-row">
          <code className="wh-secret-value">{showSecret ? webhook.secret : "\u2022".repeat(32)}</code>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowSecret((s) => !s)}>
            {showSecret ? "Hide" : "Show"}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRegenerate}>
            Regenerate
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="wh-item-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggleDeliveries()}>
          {showDeliveries ? "Hide deliveries" : "Recent deliveries"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm wh-danger" onClick={onDelete}>
          Delete
        </button>
      </div>

      {/* Deliveries */}
      {showDeliveries ? (
        <div className="wh-table-wrap">
          {loadingDeliveries ? (
            <p className="field-help">Loading deliveries...</p>
          ) : deliveriesError ? (
            <p className="submit-error">{deliveriesError}</p>
          ) : deliveries.length === 0 ? (
            <p className="field-help">No deliveries yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--color-text-subtle)" }}>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Attempts</th>
                  <th style={{ padding: "6px 8px" }}>Response</th>
                  <th style={{ padding: "6px 8px" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={statusBadgeStyle(d.status)}>{STATUS_LABELS[d.status]}</span>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{d.attempts}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {d.lastResponseStatus != null ? d.lastResponseStatus : d.lastError ? "\u2014" : ""}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {formatRelativeTime(d.deliveredAt ?? d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </div>
  );
}
