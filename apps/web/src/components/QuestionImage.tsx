import type { CSSProperties } from "react";
import type { ImageAlign } from "../types";

/** Size choices offered in the image menu. `null` keeps the original size. */
// eslint-disable-next-line react-refresh/only-export-components -- shared constant/helper kept next to its component; moving it would change module layout
export const IMAGE_SIZES: ReadonlyArray<{ id: string; label: string; width: number | null }> = [
  { id: "small", label: "Small", width: 25 },
  { id: "medium", label: "Medium", width: 50 },
  { id: "large", label: "Large", width: 75 },
  { id: "original", label: "Original", width: null },
];

const FLEX_ALIGN: Record<ImageAlign, CSSProperties["alignItems"]> = {
  LEFT: "flex-start",
  CENTER: "center",
  RIGHT: "flex-end",
};

/**
 * Layout styles for a question image. The figure is a full-width flex column so
 * alignment does not depend on inherited text-align or the parent's layout, and
 * the caption sits in the same box as the image so it follows the same side.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared constant/helper kept next to its component; moving it would change module layout
export function imageLayout(
  align: ImageAlign | undefined,
  width: number | undefined | null,
): { figure: CSSProperties; box: CSSProperties } {
  const a = align ?? "LEFT";
  const percent = typeof width === "number" && width > 0 && width < 100 ? width : null;
  return {
    figure: {
      margin: "8px 0",
      width: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: FLEX_ALIGN[a],
    },
    box: {
      maxWidth: "100%",
      textAlign: a.toLowerCase() as CSSProperties["textAlign"],
      ...(percent !== null ? { width: `${percent}%` } : {}),
    },
  };
}

/**
 * A question or block image with alignment, optional width and caption. The alt
 * text is the caption when present, otherwise the question label.
 */
export function QuestionImage({
  url,
  align,
  width,
  caption,
  label,
}: {
  url: string;
  align?: ImageAlign | undefined;
  width?: number | undefined;
  caption?: string | null | undefined;
  label?: string | undefined;
}) {
  const alt = caption || label || "";
  const layout = imageLayout(align, width);
  return (
    <figure className="question-image" data-align={align ?? "LEFT"} style={layout.figure}>
      <div style={layout.box}>
        <img
          src={url}
          alt={alt}
          loading="lazy"
          style={{ maxWidth: "100%", height: "auto", display: "block", width: width && width < 100 ? "100%" : undefined, marginLeft: align === "CENTER" ? "auto" : align === "RIGHT" ? "auto" : 0, marginRight: align === "CENTER" ? "auto" : 0 }}
        />
        {caption ? (
          <figcaption className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
            {caption}
          </figcaption>
        ) : null}
      </div>
    </figure>
  );
}