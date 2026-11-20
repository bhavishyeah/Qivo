// Stable React keys for rows that have no id of their own (e.g. choice options,
// which are stored as { value, label } where value is derived from the label).
// Keying on the typed text remounts the input on every keystroke and drops
// focus, so each row gets a generated key that moves with add/remove instead.

import { useState } from "react";

let counter = 0;
const nextKey = () => `row-${++counter}`;

export function useStableKeys(length: number): {
  keys: string[];
  addKey: () => void;
  removeKey: (index: number) => void;
} {
  const [stored, setStored] = useState<string[]>(() => Array.from({ length }, nextKey));
  // Rows added or dropped outside add/remove (e.g. a type change) are padded or
  // trimmed here without disturbing the keys of the rows that remain.
  const keys =
    stored.length === length
      ? stored
      : stored.length > length
        ? stored.slice(0, length)
        : [...stored, ...Array.from({ length: length - stored.length }, (_, i) => `pad-${stored.length + i}`)];
  return {
    keys,
    addKey: () => setStored([...keys, nextKey()]),
    removeKey: (index) => setStored(keys.filter((_, i) => i !== index)),
  };
}