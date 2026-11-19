/** Insert `item` right after the entry with id `afterId`; append when `afterId` is null or unknown. */
export function insertAfterId<T extends { id: string }>(list: T[], item: T, afterId: string | null): T[] {
  const index = afterId === null ? -1 : list.findIndex((entry) => entry.id === afterId);
  if (index < 0) return [...list, item];
  return [...list.slice(0, index + 1), item, ...list.slice(index + 1)];
}

/** Selectors whose clicks must not collapse the active question. */
const KEEP_OPEN_SELECTOR = [
  ".editor-question", // the card itself (other cards activate themselves on click)
  ".editor-floating-toolbar",
  ".editor-card-header", // "+ Add question"
  ".add-question-form",
  ".editor-topnav", // undo / redo / publish
  "[role='listbox']",
  "[role='menu']",
  "[role='dialog']",
  "[role='alertdialog']",
  "[aria-modal='true']",
  "[data-radix-popper-content-wrapper]",
].join(",");

/** True when a pointerdown on `target` should deselect the active question. */
export function shouldCollapseOnPointerDown(target: EventTarget | null): boolean {
  const el = target as (Element & { isConnected?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return false;
  // Scrollbar presses report the root element; detached nodes were removed mid-click.
  if (el.isConnected === false || el === el.ownerDocument?.documentElement) return false;
  return el.closest(KEEP_OPEN_SELECTOR) === null;
}

/**
 * Vertical offset (px, relative to the canvas top) for the floating add buttons.
 * `anchorTop`/`anchorHeight` describe the followed card relative to the canvas
 * (null = follow the viewport). `canvasViewportTop` is the canvas top in the
 * viewport, `stickyOffset` the distance kept from the viewport top.
 */
export function computeToolbarTop(args: {
  anchorTop: number | null;
  anchorHeight: number;
  canvasViewportTop: number;
  canvasHeight: number;
  toolbarHeight: number;
  stickyOffset: number;
}): number {
  const { anchorTop, anchorHeight, canvasViewportTop, canvasHeight, toolbarHeight, stickyOffset } = args;
  const maxTop = Math.max(0, canvasHeight - toolbarHeight);
  const viewportTop = stickyOffset - canvasViewportTop; // canvas-relative top of the visible area
  let top: number;
  if (anchorTop === null) {
    top = viewportTop;
  } else {
    // Stay beside the card; if the card is tall, slide down with the viewport but never past the card's bottom.
    const lowest = anchorTop + Math.max(0, anchorHeight - toolbarHeight);
    top = Math.min(Math.max(anchorTop, viewportTop), lowest);
  }
  return Math.round(Math.min(Math.max(0, top), maxTop));
}