import type { MenuKey } from "./menuNav";

/** One entry in a <Select>. `group` puts the option under a heading; options without one come first. */
export type SelectOption = {
  value: string;
  label: string;
  /** Muted second line under the label. */
  description?: string;
  /** Short muted text on the right, e.g. "12 questions". */
  meta?: string;
  disabled?: boolean;
  group?: string;
  /** Inline style for the label, e.g. a font-family preview. */
  labelStyle?: Record<string, string>;
};

export type SelectGroup = {
  label?: string;
  items: { option: SelectOption; index: number }[];
};

/** Split options into display groups. Index is the position in the original flat list. */
export function groupSelectOptions(options: SelectOption[]): SelectGroup[] {
  const groups: SelectGroup[] = [];
  const byLabel = new Map<string, SelectGroup>();
  options.forEach((option, index) => {
    const key = option.group ?? "";
    let group = byLabel.get(key);
    if (!group) {
      group = { label: option.group, items: [] };
      byLabel.set(key, group);
      groups.push(group);
    }
    group.items.push({ option, index });
  });
  // Ungrouped options always lead.
  groups.sort((a, b) => Number(a.label !== undefined) - Number(b.label !== undefined));
  return groups;
}

/** Options in the order they are displayed (grouped), as indexes into the flat list. */
export function displayOrder(options: SelectOption[]): number[] {
  return groupSelectOptions(options).flatMap((g) => g.items.map((i) => i.index));
}

/**
 * Next enabled option index for a keyboard key, walking the displayed order.
 * `current` is an index into the flat list (or -1). Returns -1 when nothing is enabled.
 */
export function nextEnabledIndex(options: SelectOption[], current: number, key: MenuKey): number {
  const order = displayOrder(options).filter((i) => !options[i]!.disabled);
  if (order.length === 0) return -1;
  if (key === "Home") return order[0]!;
  if (key === "End") return order[order.length - 1]!;
  const pos = order.indexOf(current);
  if (key === "ArrowDown") return order[pos < 0 ? 0 : (pos + 1) % order.length]!;
  return order[pos <= 0 ? order.length - 1 : pos - 1]!;
}

/**
 * Typeahead: first enabled option whose label starts with `buffer`, searching
 * after `current` and wrapping. A repeated single letter cycles through matches.
 */
export function typeaheadIndex(options: SelectOption[], buffer: string, current: number): number {
  const needle = buffer.toLowerCase();
  if (!needle) return -1;
  const order = displayOrder(options).filter((i) => !options[i]!.disabled);
  if (order.length === 0) return -1;
  const cycling = needle.length > 1 && [...needle].every((c) => c === needle[0]);
  const query = cycling ? needle[0]! : needle;
  const start = order.indexOf(current);
  const offset = query.length === 1 || cycling ? 1 : 0;
  for (let step = 0; step < order.length; step++) {
    const idx = order[(Math.max(start, 0) + (start < 0 ? 0 : offset) + step) % order.length]!;
    if (options[idx]!.label.toLowerCase().startsWith(query)) return idx;
  }
  return -1;
}
