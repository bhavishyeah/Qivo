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

function statusBadgeStyle(status: WebhookDelivery["status"]): React.CSSProperties {
  const palette: Record<WebhookDelivery["status"], { bg: string; fg: string }> = {
    delivered: { bg: "#dcfce7", fg: "#166534" },
    pending: { bg: "#fef9c3", fg: "#854d0e" },
    failed: { bg: "#fee2e2", fg: "#991b1b" },
    exhausted: { bg: "#e5e7eb", fg: "#374151" },
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
  const [adding, setAdding] = useState(false);

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
      const data = await api.post<{ webhook: Webhook }>(`/api/forms/${formId}/webhooks`, {
        url: url.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setWebhooks((prev) => [...prev, data.webhook]);
      setUrl("");
      setDescription("");
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
    <section className="editor-card" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="editor-card-header">
        <div>
          <p className="eyebrow">Webhooks</p>
          <h2>Outbound webhooks</h2>
        </div>
      </div>

      <p style={{ color: "#475569", marginTop: 0 }}>
        Qivo POSTs each new response to the endpoints you configure here. Every
        request is signed with the webhook&apos;s secret (header{" "}
        <code>X-Qivo-Signature: sha256=&lt;hex&gt;</code>) so your receiver can
        verify it. Failed deliveries retry automatically with backoff.
      </p>

      {error ? <p className="submit-error">{error}</p> : null}
      {message ? <p style={{ color: "#166534" }}>{message}</p> : null}

      {/* Add webhook */}
      <form onSubmit={handleAdd} style={{ display: "grid", gap: 10, marginBottom: 24 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: 600 }}>Endpoint URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhooks/qivo"
            required
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontWeight: 600 }}>Description (optional)</span>
          <input
            type="text"
            value={description}
            maxLength={200}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Zapier intake"
          />
        </label>
        <div>
          <button type="submit" className="secondary-button" disabled={adding}>
            {adding ? "Adding..." : "Add webhook"}
          </button>
        </div>
      </form>

      {/* List */}
      {loading ? (
        <p style={{ color: "#64748b" }}>Loading webhooks...</p>
      ) : webhooks.length === 0 ? (
        <p style={{ color: "#64748b" }}>No webhooks yet. Add one above.</p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
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
    <div
      className="editor-card"
      style={{ padding: 16, margin: 0, border: "1px solid #e2e8f0" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 600, wordBreak: "break-all" }}>{webhook.url}</p>
          {webhook.description ? (
            <p style={{ margin: "4px 0 0", color: "#64748b" }}>{webhook.description}</p>
          ) : null}
        </div>
        <label className="settings-toggle" style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={webhook.enabled} onChange={onToggle} />
          <span>{webhook.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>

      {/* Secret */}
      <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Signing secret</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <code
            style={{
              background: "#f1f5f9",
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 13,
              wordBreak: "break-all",
              flex: "1 1 240px",
            }}
          >
            {showSecret ? webhook.secret : "•".repeat(32)}
          </code>
          <button type="button" className="secondary-button compact" onClick={() => setShowSecret((s) => !s)}>
            {showSecret ? "Hide" : "Show"}
          </button>
          <button type="button" className="secondary-button compact" onClick={onCopy}>
            Copy
          </button>
          <button type="button" className="secondary-button compact" onClick={onRegenerate}>
            Regenerate
          </button>
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="secondary-button compact" onClick={() => void toggleDeliveries()}>
          {showDeliveries ? "Hide deliveries" : "Recent deliveries"}
        </button>
        <button
          type="button"
          className="secondary-button compact"
          onClick={onDelete}
          style={{ color: "#b91c1c" }}
        >
          Delete
        </button>
      </div>

      {/* Deliveries */}
      {showDeliveries ? (
        <div style={{ marginTop: 12 }}>
          {loadingDeliveries ? (
            <p style={{ color: "#64748b" }}>Loading deliveries...</p>
          ) : deliveriesError ? (
            <p className="submit-error">{deliveriesError}</p>
          ) : deliveries.length === 0 ? (
            <p style={{ color: "#64748b" }}>No deliveries yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Attempts</th>
                  <th style={{ padding: "6px 8px" }}>Response</th>
                  <th style={{ padding: "6px 8px" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={statusBadgeStyle(d.status)}>{STATUS_LABELS[d.status]}</span>
                    </td>
                    <td style={{ padding: "6px 8px" }}>{d.attempts}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {d.lastResponseStatus != null ? d.lastResponseStatus : d.lastError ? "—" : ""}
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
