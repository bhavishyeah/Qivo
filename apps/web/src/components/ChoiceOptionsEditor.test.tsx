// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChoiceOptionsEditor from "./ChoiceOptionsEditor";
import type { QuestionOption } from "../types";

afterEach(cleanup);

function Harness({ initial, other = false }: { initial: QuestionOption[]; other?: boolean }) {
  const [options, setOptions] = useState(initial);
  const [otherOn, setOtherOn] = useState(other);
  return (
    <ChoiceOptionsEditor
      type="MULTIPLE_CHOICE"
      options={options}
      allowsOther
      otherOn={otherOn}
      shuffleOn={false}
      onOptionsChange={setOptions}
      onAllowOther={setOtherOn}
      onShuffleOff={() => {}}
    />
  );
}

const THREE: QuestionOption[] = [
  { value: "option_1", label: "Option 1" },
  { value: "option_2", label: "Option 2" },
  { value: "option_3", label: "Option 3" },
];

describe("ChoiceOptionsEditor", () => {
  it("keeps the same input node and focus while typing several characters", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ value: "option_1", label: "" }]} />);
    const input = screen.getByLabelText("Option 1") as HTMLInputElement;
    await user.click(input);
    await user.type(input, "hello world");
    const after = screen.getByLabelText("Option 1") as HTMLInputElement;
    expect(after).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("hello world");
  });

  it("keeps the caret where it was typed when editing the middle of the text", async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ value: "a", label: "ad" }]} />);
    const input = screen.getByLabelText("Option 1") as HTMLInputElement;
    await user.click(input);
    input.setSelectionRange(1, 1);
    await user.keyboard("bc");
    expect(input.value).toBe("abcd");
    expect(input.selectionStart).toBe(3);
    expect(document.activeElement).toBe(input);
  });

  it("does not remount other rows when two options end up with the same text", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} />);
    const first = screen.getByLabelText("Option 1") as HTMLInputElement;
    const second = screen.getByLabelText("Option 2") as HTMLInputElement;
    await user.clear(second);
    await user.type(second, "Option 1");
    expect(screen.getByLabelText("Option 1")).toBe(first);
    expect(screen.getByLabelText("Option 2")).toBe(second);
    expect(second.value).toBe("Option 1");
  });

  it("keeps surviving rows mounted after add and remove, and focus while typing in the new row", async () => {
    const user = userEvent.setup();
    render(<Harness initial={THREE} other />);
    const first = screen.getByLabelText("Option 1") as HTMLInputElement;
    const third = screen.getByLabelText("Option 3") as HTMLInputElement;

    await user.click(screen.getByRole("button", { name: "Add option" }));
    const fourth = screen.getByLabelText("Option 4") as HTMLInputElement;
    await user.clear(fourth);
    await user.type(fourth, "Fresh");
    expect(screen.getByLabelText("Option 4")).toBe(fourth);
    expect(document.activeElement).toBe(fourth);
    expect(fourth.value).toBe("Fresh");

    await user.click(screen.getAllByRole("button", { name: "Remove option" })[1]!);
    expect(screen.getByLabelText("Option 1")).toBe(first);
    // The old third row is now the second; it is the same node.
    expect(screen.getByLabelText("Option 2")).toBe(third);
    expect(screen.getByText("Other...")).toBeTruthy();
  });
});