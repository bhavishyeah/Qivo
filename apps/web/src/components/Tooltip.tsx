import type { ReactElement } from "react";

/** Hover and focus label for icon-only controls. The child keeps its own aria-label, so the bubble is hidden from assistive tech. */
export default function Tooltip({ text, children }: { text: string; children: ReactElement }) {
  return (
    <span className="tooltip-wrap">
      {children}
      <span className="tooltip" aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
