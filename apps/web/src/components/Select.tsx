import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { computeMenuPosition, type MenuKey } from "../lib/menuNav";
import { groupSelectOptions, nextEnabledIndex, typeaheadIndex, type SelectOption } from "../lib/selectNav";
import { CaretIcon } from "./questionIcons";

export type { SelectOption } from "../lib/selectNav";

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Id for the trigger button so an external <label htmlFor> works. */
  id?: string;
  /** Accessible name when there is no visible <label>. */
  "aria-label"?: string;
  /** Submitted as a hidden input when set, so the control works inside a <form>. */
  name?: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Stretch to the container width. Default true. */
  fullWidth?: boolean;
  className?: string;
  style?: CSSProperties;
};

const SHEET_QUERY = "(max-width: 520px)";

type ListboxProps = {
  id: string;
  options: SelectOption[];
  value: string;
  onChoose: (value: string) => void;
};

/** The option list. Pure (no state or portal) so it can be rendered to static markup in tests. */
export function SelectListbox({ id, options, value, onChoose }: ListboxProps) {
  const groups = groupSelectOptions(options);
  return (
    <>
      {groups.map((group, gi) => {
        const headingId = `${id}-g${gi}`;
        const items = group.items.map(({ option, index }) => {
          const selected = option.value === value;
          return (
            <div
              key={option.value}
              id={`${id}-o${index}`}
              role="option"
              tabIndex={-1}
              data-index={index}
              aria-selected={selected}
              aria-disabled={option.disabled || undefined}
              className={`select-option${selected ? " is-selected" : ""}${option.disabled ? " is-disabled" : ""}`}
              onClick={() => {
                if (!option.disabled) onChoose(option.value);
              }}
            >
              <span className="select-option-text">
                <span className="select-option-label" style={option.labelStyle}>{option.label}</span>
                {option.description ? <span className="select-option-desc">{option.description}</span> : null}
              </span>
              {option.meta ? <span className="select-option-meta">{option.meta}</span> : null}
              <span className="select-option-check" aria-hidden="true">
                {selected ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                ) : null}
              </span>
            </div>
          );
        });
        return group.label ? (
          <div key={headingId} role="group" aria-labelledby={headingId} className="select-group">
            <div id={headingId} className="select-group-heading" role="presentation">{group.label}</div>
            {items}
          </div>
        ) : (
          <div key={headingId} role="presentation" className="select-group">{items}</div>
        );
      })}
    </>
  );
}

export default function Select({
  value,
  options,
  onChange,
  id,
  "aria-label": ariaLabel,
  name,
  placeholder = "Select\u2026",
  disabled = false,
  size = "md",
  fullWidth = true,
  className,
  style,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", timer: 0 });
  const listId = useId();

  const selected = options.find((o) => o.value === value);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPos(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list || list.dataset.sheet === "true") return;
    const rect = trigger.getBoundingClientRect();
    const next = computeMenuPosition(
      rect,
      { width: list.offsetWidth, height: list.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ top: next.top, left: next.left, minWidth: rect.width });
  }, []);

  function optionEl(index: number): HTMLElement | null {
    return listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null;
  }

  function activeIndex(): number {
    const el = document.activeElement as HTMLElement | null;
    return el && listRef.current?.contains(el) ? Number(el.dataset.index ?? -1) : -1;
  }

  // Position before paint, then focus the selected (or first enabled) option.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const start = selected && !selected.disabled ? options.indexOf(selected) : nextEnabledIndex(options, -1, "Home");
    const el = optionEl(start);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    }
    function onScroll(event: Event) {
      // Scrolling the list itself must not move it.
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return;
      reposition();
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, close, reposition]);

  useEffect(() => {
    const t = typed.current;
    return () => window.clearTimeout(t.timer);
  }, []);

  function openList() {
    if (disabled) return;
    setSheet(typeof window.matchMedia === "function" && window.matchMedia(SHEET_QUERY).matches);
    setOpen(true);
  }

  function choose(next: string) {
    close(true);
    if (next !== value) onChange(next);
  }

  /** Accumulate typed characters for ~600 ms and return the matching option index. */
  function typeahead(key: string, from: number): number {
    const t = typed.current;
    window.clearTimeout(t.timer);
    t.text += key;
    t.timer = window.setTimeout(() => {
      t.text = "";
    }, 600);
    return typeaheadIndex(options, t.text, from);
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = nextEnabledIndex(options, activeIndex(), event.key as MenuKey);
      const el = optionEl(next);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex()];
      if (option && !option.disabled) choose(option.value);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const next = typeahead(event.key, activeIndex());
      const el = optionEl(next);
      if (el) {
        event.preventDefault();
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (open || disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openList();
      return;
    }
    // Typing on a closed trigger changes the value, like a native select.
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const next = typeahead(event.key, selected ? options.indexOf(selected) : -1);
      const option = options[next];
      if (option && option.value !== value) onChange(option.value);
    }
  }

  const triggerLabel = selected?.label ?? placeholder;
  const accessibleName = ariaLabel ? `${ariaLabel}: ${triggerLabel}` : undefined;
  const classes = [
    "select-trigger",
    size === "sm" ? "is-sm" : "",
    fullWidth ? "is-full" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={classes}
        style={style}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={accessibleName}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close(false);
          else openList();
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`select-trigger-text${selected ? "" : " is-placeholder"}`} style={selected?.labelStyle}>
          {triggerLabel}
        </span>
        <CaretIcon size={16} />
      </button>

      {open
        ? createPortal(
            <div className="app-root">
              {sheet ? <div className="select-backdrop" aria-hidden="true" /> : null}
              <div
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label={ariaLabel ?? "Options"}
                data-sheet={sheet ? "true" : undefined}
                className={`popover-menu select-panel${sheet ? " is-sheet" : ""}`}
                style={{
                  position: "fixed",
                  ...(sheet ? {} : { top: pos?.top ?? 0, left: pos?.left ?? 0, minWidth: pos?.minWidth }),
                  visibility: pos || sheet ? "visible" : "hidden",
                }}
                onKeyDown={onListKeyDown}
              >
                <SelectListbox id={listId} options={options} value={value} onChoose={choose} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
