import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { api, ApiRequestError } from "../lib/api";
import type { FormRecord } from "../types";

export default function FormSharePage() {
  const { formId } = useParams<{ formId: string }>();

  const [form, setForm] = useState<FormRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  const publicUrl = form ? `${window.location.origin}/f/${form.slug}` : "";
  const displayUrl = form
    ? `${window.location.origin}/f/${form.slug}/display`
    : "";

  useEffect(() => {
    async function loadForm() {
      if (!formId) {
        setError("Form ID is missing.");
        setLoading(false);
        return;
      }

      try {
        const data = await api.get<{ form: FormRecord }>(
          `/api/forms/${formId}`,
        );
        setForm(data.form);
      } catch (err) {
        setError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to load form.",
        );
      } finally {
        setLoading(false);
      }
    }

    void loadForm();
  }, [formId]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = publicUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicUrl]);

  function downloadPng() {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current.querySelector("canvas");
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = `${form?.title ?? "form"}-qr.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  function downloadSvg() {
    if (!canvasRef.current) return;
    // We use a hidden SVG render for download
    const svgElement = document.getElementById("qr-svg-download");
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${form?.title ?? "form"}-qr.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="status-card">
          <p>Loading...</p>
        </div>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="page-shell">
        <div className="status-card error-card">
          <h1>Unable to load form</h1>
          <p>{error || "Form not found."}</p>
        </div>
      </main>
    );
  }

  const isPublished = form.status === "PUBLISHED";

  return (
    <main className="page-shell">
      <section className="auth-card" style={{ maxWidth: 640 }}>
        <p className="eyebrow">Share & QR</p>

        <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)" }}>
          {form.title}
        </h1>

        {!isPublished ? (
          <div
            className="submit-error"
            style={{ marginBottom: 24, background: "#fef3c7", color: "#92400e" }}
          >
            This form is not published yet. Publish it from the editor to make
            the public link and QR code active.
          </div>
        ) : null}

        <div style={{ marginBottom: 28 }}>
          <label
            style={{
              display: "block",
              marginBottom: 8,
              fontWeight: 750,
              color: "#1e293b",
            }}
          >
            Public link
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="text"
              readOnly
              value={publicUrl}
              style={{
                flex: 1,
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "12px 14px",
                background: "#f8fafc",
                color: "#334155",
              }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyLink()}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
            marginBottom: 28,
            padding: 28,
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            background: "#ffffff",
          }}
        >
          <QRCodeSVG
            value={publicUrl}
            size={220}
            level="H"
            bgColor="#ffffff"
            fgColor="#0f172a"
          />

          {/* Hidden canvas for PNG download */}
          <div ref={canvasRef} style={{ display: "none" }}>
            <QRCodeCanvas value={publicUrl} size={1024} level="H" />
          </div>

          {/* Hidden SVG for SVG download */}
          <div style={{ display: "none" }}>
            <QRCodeSVG
              id="qr-svg-download"
              value={publicUrl}
              size={1024}
              level="H"
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 28,
          }}
        >
          <button
            className="secondary-button"
            type="button"
            onClick={downloadPng}
          >
            Download PNG
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={downloadSvg}
          >
            Download SVG
          </button>
          <Link className="secondary-button" to={displayUrl} target="_blank">
            Display mode
          </Link>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="secondary-link" to={`/forms/${formId}/edit`}>
            ← Back to editor
          </Link>
          <Link className="secondary-link" to="/dashboard">
            Dashboard
          </Link>
        </div>
      </section>
    </main>
  );
}
