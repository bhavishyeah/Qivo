import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { publicGet, ApiRequestError } from "../lib/api";
import type { PublicForm } from "../types";

export default function QRDisplayPage() {
  const { slug } = useParams<{ slug: string }>();

  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [darkMode, setDarkMode] = useState(false);

  const publicUrl = `${window.location.origin}/f/${slug}`;

  useEffect(() => {
    async function loadForm() {
      if (!slug) {
        setError("Form slug is missing.");
        setLoading(false);
        return;
      }

      try {
        const data = await publicGet<{ form: PublicForm }>(
          `/api/forms/public/${slug}`,
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
  }, [slug]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "d" || event.key === "D") {
        setDarkMode((prev) => !prev);
      }
      if (event.key === "f" || event.key === "F") {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          void document.documentElement.requestFullscreen();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (loading) {
    return (
      <main className="qr-display" data-dark={darkMode}>
        <p style={{ fontSize: "1.5rem" }}>Loading...</p>
      </main>
    );
  }

  if (error || !form) {
    return (
      <main className="qr-display" data-dark={darkMode}>
        <p style={{ fontSize: "1.5rem", color: "#ef4444" }}>
          {error || "Form not found."}
        </p>
      </main>
    );
  }

  return (
    <main className="qr-display" data-dark={darkMode}>
      <div className="qr-display-content">
        <p className="qr-display-eyebrow">Scan to respond</p>

        <h1 className="qr-display-title">{form.title}</h1>

        {form.description ? (
          <p className="qr-display-description">{form.description}</p>
        ) : null}

        <div className="qr-display-code">
          <QRCodeSVG
            value={publicUrl}
            size={320}
            level="H"
            bgColor={darkMode ? "#0f172a" : "#ffffff"}
            fgColor={darkMode ? "#ffffff" : "#0f172a"}
          />
        </div>

        <p className="qr-display-url">{publicUrl}</p>

        <p className="qr-display-hint">
          Press <kbd>D</kbd> to toggle dark mode · <kbd>F</kbd> for fullscreen
        </p>
      </div>
    </main>
  );
}
