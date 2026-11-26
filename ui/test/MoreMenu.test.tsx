// The [⋯] menu: opening, choosing with the pointer or the keyboard, and where focus goes when it closes
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { MoreMenu } from "../src/admin/MoreMenu";

function setup() {
  const actions = [vi.fn(), vi.fn(), vi.fn()];
  const labels = ["First", "Second", "Third"];
  render(
    <>
      <MoreMenu
        trigger={createRef()}
        items={labels.map((label, i) => ({
          label,
          icon: null,
          action: actions[i],
        }))}
      />
      <button type="button">Elsewhere</button>
    </>,
  );
  const user = userEvent.setup();
  const more = screen.getByRole("button", { name: "More actions" });
  const item = (name: string) => screen.getByRole("menuitem", { name });
  return { user, actions, more, item };
}

describe("the More menu", () => {
  it("opens on a click and runs the item clicked", async () => {
    const { user, actions, more, item } = setup();
    expect(more.getAttribute("aria-expanded")).toBe("false");

    await user.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");

    await user.click(item("Second"));
    expect(actions[1]).toHaveBeenCalledTimes(1);
    expect(actions[0]).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from the keyboard on its first item and moves with the arrow keys, Home and End", async () => {
    const { user, more, item } = setup();
    more.focus();

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(item("First"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("Second"));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(item("Third"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(item("First"));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(item("Third"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(item("First"));
  });

  it("runs the focused item on Enter", async () => {
    const { user, actions, more } = setup();
    more.focus();

    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{Enter}");
    expect(actions[2]).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Esc and gives focus back to its button", async () => {
    const { user, actions, more } = setup();
    await user.click(more);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(more));
    expect(actions.some((action) => action.mock.calls.length)).toBe(false);
  });

  it("closes on a click elsewhere without running anything", async () => {
    const { user, actions, more } = setup();
    await user.click(more);

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(actions.some((action) => action.mock.calls.length)).toBe(false);
  });
});
