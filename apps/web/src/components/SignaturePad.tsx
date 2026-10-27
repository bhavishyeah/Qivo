// Reusable signature-capture canvas built on `signature_pad` v5. It is
// upload-agnostic: it owns a <canvas> + Clear button and exposes imperative
// methods via ref (isEmpty / clear / toPngFile). The parent decides WHEN to
// materialize the PNG (on an explicit "Save signature" action) and owns the
// upload. Used by both the public form (uploads) and the preview page
// (interactive, no upload).

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import SignaturePadLib from "signature_pad";

export type SignaturePadHandle = {
  isEmpty: () => boolean;
  clear: () => void;
  /** Resolves to a PNG File, or null if the pad is empty / encode failed. */
  toPngFile: () => Promise<File | null>;
};

export type SignaturePadProps = {
  /**
   * Fires on every beginStroke/endStroke and after clear, reporting the
   * current pad.isEmpty(). Lets callers toggle a Save button and clear a stale
   * uploaded URL. Idempotent — safe to call on each stroke.
   */
  onChange?: (isEmpty: boolean) => void;
  /**
   * Disable drawing (e.g. while an upload is in flight). Default false.
   * Enforced via a CSS pointer-events wrapper, NOT via pad.off() — off() is
   * reserved strictly for unmount teardown.
   */
  disabled?: boolean;
  /** Canvas CSS height in px, default 200. */
  height?: number;
  ariaLabel?: string;
};

const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad(
    { onChange, disabled = false, height = 200, ariaLabel = "Signature canvas" },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const padRef = useRef<SignaturePadLib | null>(null);
    // Keep the latest onChange in a ref so the mount effect's listeners never
    // need re-subscribing when the callback identity changes.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Opaque white background so the exported PNG is never transparent (black
      // strokes on white render correctly on light thumbnail cards).
      const pad = new SignaturePadLib(canvas, {
        backgroundColor: "rgb(255,255,255)",
      });
      padRef.current = pad;

      // High-DPI: size the backing store to the measured CSS box * dpr, then
      // scale the 2d context so strokes aren't blurry. Resizing the backing
      // store wipes it (strokes AND the white fill), so follow every resize
      // with pad.clear() — that repaints the backgroundColor and leaves a clean
      // empty canvas. The resize rule and the white-fill rule are one call.
      const resize = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(ratio, ratio);
        pad.clear();
      };
      resize();

      let resizeTimer: ReturnType<typeof setTimeout> | undefined;
      const onResize = () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 150);
      };
      window.addEventListener("resize", onResize);

      // Report emptiness on every stroke boundary. pad.isEmpty() is idempotent,
      // so no first-stroke tracking is needed. Matched pair with the
      // removeEventListener calls in cleanup (NIT #5 — do not mix with off()).
      const handleStroke = () => onChangeRef.current?.(pad.isEmpty());
      pad.addEventListener("beginStroke", handleStroke);
      pad.addEventListener("endStroke", handleStroke);

      return () => {
        window.removeEventListener("resize", onResize);
        if (resizeTimer) clearTimeout(resizeTimer);
        pad.removeEventListener("beginStroke", handleStroke);
        pad.removeEventListener("endStroke", handleStroke);
        // Teardown only: off() detaches all pointer/touch listeners.
        pad.off();
        padRef.current = null;
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        isEmpty: () => padRef.current?.isEmpty() ?? true,
        clear: () => {
          padRef.current?.clear();
          onChangeRef.current?.(true);
        },
        toPngFile: () =>
          new Promise<File | null>((resolve) => {
            const pad = padRef.current;
            const canvas = canvasRef.current;
            if (!pad || !canvas || pad.isEmpty()) return resolve(null);
            // Export from the same DPR-scaled canvas the pad draws on — one
            // path, no toDataURL round-trip or double DPR scaling.
            canvas.toBlob(
              (blob) =>
                resolve(
                  blob
                    ? new File([blob], "signature.png", { type: "image/png" })
                    : null,
                ),
              "image/png",
            );
          }),
      }),
      [],
    );

    return (
      <div>
        <div
          style={{
            // Always a 2px dashed border (NIT #4 — do not switch to solid).
            border: "2px dashed #cbd5e1",
            borderRadius: 12,
            background: "#f8fafc",
            overflow: "hidden",
            // Transient disable: CSS gate only, never a library call.
            pointerEvents: disabled ? "none" : "auto",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <canvas
            ref={canvasRef}
            aria-label={ariaLabel}
            style={{
              display: "block",
              width: "100%",
              height,
              touchAction: "none",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Sign above</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              padRef.current?.clear();
              onChangeRef.current?.(true);
            }}
            style={{
              fontSize: 12,
              color: "#475569",
              background: "transparent",
              border: "none",
              cursor: disabled ? "default" : "pointer",
              padding: 0,
            }}
          >
            Clear
          </button>
        </div>
      </div>
    );
  },
);

export default SignaturePad;
