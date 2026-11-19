export type MenuKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Next focused index for a vertical menu. ArrowDown/ArrowUp wrap around. */
export function nextMenuIndex(current: number, key: MenuKey, count: number): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  return current <= 0 ? count - 1 : current - 1;
}

export type Rect = { top: number; left: number; right: number; bottom: number; width: number; height: number };
export type Size = { width: number; height: number };

export const MENU_VIEWPORT_MARGIN = 8;
const MENU_GAP = 4;

/**
 * Position a menu below the trigger, left aligned. Flips above when it would
 * overflow the bottom, shifts left when it would overflow the right edge, and
 * clamps to an 8px viewport margin.
 */
export function computeMenuPosition(
  anchor: Rect,
  menu: Size,
  viewport: Size,
): { top: number; left: number; placement: "below" | "above" } {
  const m = MENU_VIEWPORT_MARGIN;

  let left = anchor.left;
  if (left + menu.width > viewport.width - m) left = anchor.right - menu.width;
  left = Math.max(m, Math.min(left, viewport.width - m - menu.width));

  let top = anchor.bottom + MENU_GAP;
  let placement: "below" | "above" = "below";
  if (top + menu.height > viewport.height - m) {
    const above = anchor.top - MENU_GAP - menu.height;
    if (above >= m) {
      top = above;
      placement = "above";
    }
  }
  top = Math.max(m, Math.min(top, viewport.height - m - menu.height));

  return { top, left, placement };
}
