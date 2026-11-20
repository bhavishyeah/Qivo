// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Select, { type SelectOption } from "./Select";

const OPTIONS: SelectOption[] = [
  { value: "", label: "Blank form", description: "Start empty" },
  { value: "a", label: "Alpha", description: "First template", meta: "3 questions", group: "Templates" },
  { value: "b", label: "Bravo", group: "Templates", disabled: true },
  { value: "c", label: "Charlie", group: "Templates" },
  { value: "d", label: "Delta", group: "Yours" },
];

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <label htmlFor="t">Template</label>
      <Select
        id="t"
        value={value}
        options={OPTIONS}
        name="template"
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
      />
      <button type="button">after</button>
    </>
  );
}

describe("Select", () => {
  it("shows the selected label and opens a listbox on click", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Template" });
    expect(trigger.textContent).toContain("Blank form");
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("renders group headings, descriptions and metadata", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Template" }));
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-labelledby")).every(Boolean)).toBe(true);
    expect(within(groups[0]!).getByText("Templates")).toBeTruthy();
    expect(within(groups[1]!).getByText("Yours")).toBeTruthy();
    expect(screen.getByText("First template")).toBeTruthy();
    expect(screen.getByText("3 questions")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(5);
    const selected = screen.getByRole("option", { selected: true });
    expect(selected.textContent).toContain("Blank form");
    expect(selected.querySelector("svg")).not.toBeNull();
  });

  it("moves focus with arrow keys, skips disabled options, and selects with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Template" }));
    expect(document.activeElement?.textContent).toContain("Blank form");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Alpha");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Charlie");
    await user.keyboard("{End}");
    expect(document.activeElement?.textContent).toContain("Delta");
    await user.keyboard("{Home}");
    expect(document.activeElement?.textContent).toContain("Blank form");
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement?.textContent).toContain("Delta");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("d");
    expect(screen.queryByRole("listbox")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Template" });
    expect(trigger.textContent).toContain("Delta");
    expect(document.activeElement).toBe(trigger);
  });

  it("supports typeahead inside the list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Template" }));
    await user.keyboard("c");
    expect(document.activeElement?.textContent).toContain("Charlie");
  });

  it("closes on Escape and returns focus to the trigger without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Template" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes when clicking outside", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Template" }));
    await user.click(screen.getByRole("button", { name: "after" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("selects with a click, ignores disabled options, and mirrors the value into a hidden input", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { container } = render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Template" }));
    await user.click(screen.getByRole("option", { name: /Bravo/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Alpha/ }));
    expect(onChange).toHaveBeenCalledWith("a");
    const hidden = container.querySelector<HTMLInputElement>('input[type="hidden"][name="template"]');
    expect(hidden?.value).toBe("a");
  });

  it("opens with ArrowDown on the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("button", { name: "Template" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeTruthy();
  });
});
