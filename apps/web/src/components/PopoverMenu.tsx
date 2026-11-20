import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { computeMenuPosition, nextMenuIndex, type MenuKey } from "../lib/menuNav";

export type PopoverMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  hidden?: boolean;
  disabled?: boolean;
  /** Internal route (react-router Link) or external URL when `external` is set. */
  href?: string;
  external?: boolean;
  /** When defined the item is a radio-style menu item with aria-checked. */
  checked?: boolean;
  /** Renders a horizontal divider instead of an item. */
  divider?: boolean;
  /** Danger styling (e.g. Log out). */
  danger?: boolean;
  /** Renders a labelled segmented radio group; selecting keeps the menu open. */
  segments?: { id: string; label: string; checked: boolean; onSelect: () => void }[];
};

type PopoverMenuProps = {
  /** aria-label of the trigger button. */
  label: string;
  trigger: ReactNode;
  items: PopoverMenuItem[];
  triggerClassName?: string;
  /** Non-interactive block rendered above the items. */
  header?: ReactNode;
};

export default function PopoverMenu({ label, trigger, items, triggerClassName, header }: PopoverMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const visible = items.filter((item) => !item.hidden);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const next = computeMenuPosition(
      trigger.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ top: next.top, left: next.left });
  }, []);

  // Position before paint, then focus the first enabled item.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, close, reposition]);

  function menuItems(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter(
      (el) => el.getAttribute("aria-disabled") !== "true",
    );
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const els = menuItems();
      const current = els.findIndex((el) => el === document.activeElement);
      els[nextMenuIndex(current, event.key as MenuKey, els.length)]?.focus();
    }
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function select(item: PopoverMenuItem) {
    if (item.disabled) return;
    close(true);
    item.onSelect?.();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? "popover-menu-trigger"}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        {trigger}
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              className="popover-menu app-root"
              style={{
                position: "fixed",
                top: pos?.top ?? 0,
                left: pos?.left ?? 0,
                visibility: pos ? "visible" : "hidden",
              }}
              onKeyDown={onMenuKeyDown}
            >
              {header}
              {visible.map((item) => {
                if (item.divider) return <div key={item.id} role="separator" className="popover-menu-divider" />;
                if (item.segments) {
                  return (
                    <div key={item.id} className="popover-menu-segrow">
                      <span className="popover-menu-seglabel">{item.label}</span>
                      <div role="group" aria-label={item.label} className="popover-menu-segments">
                        {item.segments.map((seg) => (
                          <button
                            key={seg.id}
                            type="button"
                            role="menuitemradio"
                            aria-checked={seg.checked}
                            tabIndex={-1}
                            className="popover-menu-seg"
                            onClick={seg.onSelect}
                          >
                            {seg.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                const itemClass = item.danger ? "popover-menu-item is-danger" : "popover-menu-item";
                const content = (
                  <>
                    {item.icon ? <span className="popover-menu-icon" aria-hidden="true">{item.icon}</span> : null}
                    <span>{item.label}</span>
                  </>
                );
                if (item.href && !item.disabled) {
                  return item.external ? (
                    <a
                      key={item.id}
                      role="menuitem"
                      tabIndex={-1}
                      className={itemClass}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => close(false)}
                    >
                      {content}
                    </a>
                  ) : (
                    <Link
                      key={item.id}
                      role="menuitem"
                      tabIndex={-1}
                      className={itemClass}
                      to={item.href}
                      onClick={() => close(false)}
                    >
                      {content}
                    </Link>
                  );
                }
                return (
                  <button
                    key={item.id}
                    type="button"
                    role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                    aria-checked={item.checked}
                    tabIndex={-1}
                    className={itemClass}
                    aria-disabled={item.disabled ? true : undefined}
                    onClick={() => select(item)}
                  >
                    {content}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
