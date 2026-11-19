import type { CSSProperties } from "react";
import type { ImageAlign } from "../types";

const ALIGN_STYLE: Record<ImageAlign, CSSProperties> = {
  LEFT: { marginLeft: 0, marginRight: "auto", textAlign: "left" },
  CENTER: { marginLeft: "auto", marginRight: "auto", textAlign: "center" },
  RIGHT: { marginLeft: "auto", marginRight: 0, textAlign: "right" },
};

/**
 * A question or block image with alignment and optional caption. The alt text
 * is the caption when present, otherwise the question label.
 */
export function QuestionImage({
  url,
  align,
  caption,
  label,
}: {
  url: string;
  align?: ImageAlign | undefined;
  caption?: string | null | undefined;
  label?: string | undefined;
}) {
  const alt = caption || label || "";
  return (
    <figure
      className="question-image"
      data-align={align ?? "LEFT"}
      style={{ margin: "8px 0", ...ALIGN_STYLE[align ?? "LEFT"] }}
    >
      <img
        src={url}
        alt={alt}
        loading="lazy"
        style={{ maxWidth: "100%", height: "auto", display: "inline-block" }}
      />
      {caption ? (
        <figcaption className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
