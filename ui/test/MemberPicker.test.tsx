// The member picker: suggestions as the admin types, chosen with the arrow keys and Enter or with a click
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemberPicker } from "../src/admin/MemberPicker";
import { deriveTree } from "../src/admin/tree";
import type { TreeCtx } from "../src/admin/types";
import { api, type Access, type User } from "../src/api";

const user = (callsign: string, online: string[] = []): User => ({
  callsign,
  admin: false,
  revoked: false,
  voice_disabled: false,
  online,
});
// "a" suggests all but ECHO, a member already: ALPHA first as it is online, then A–Z
const USERS = [
  user("DELTA"),
  user("BRAVO"),
  user("ALPHA", ["/Units/20"]),
  user("CHARLIE"),
  user("ECHO"),
];

function setup(access: Access = "invite") {
  // cmdk sizes its list and scrolls to the highlight; jsdom does neither
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  const channel = {
    id: 7,
    name: "101",
    description: "",
    access,
    members: ["ECHO"],
    children: [],
  };
  const node = deriveTree([channel], USERS, [], "").byId.get(7)!;
  const run = vi.fn((_key: string, call: () => Promise<unknown>) =>
    call().then(
      () => true,
      () => false,
    ),
  );
  const ctx = { users: USERS, run, pending: new Set() } as unknown as TreeCtx;
  const onClose = vi.fn();
  // Where the open net listens for Esc
  const outside = vi.fn();
  render(
    <div onKeyDown={outside}>
      <MemberPicker node={node} ctx={ctx} onClose={onClose} />
    </div>,
  );
  const input = screen.getByRole<HTMLInputElement>("combobox", {
    name: "Callsign",
  });
  const names = () =>
    screen.queryAllByRole("option").map((option) => option.textContent);
  const highlighted = () => screen.getByRole("option", { selected: true });
  return {
    user: userEvent.setup(),
    run,
    onClose,
    outside,
    input,
    names,
    highlighted,
  };
}

describe("the member picker", () => {
  it("suggests callsigns as the admin types, the online ones marked", async () => {
    const { user, input, names } = setup();
    expect(document.activeElement).toBe(input);
    expect(names()).toEqual([]);

    await user.type(input, "a");
    expect(names()).toEqual(["onlineALPHA", "BRAVO", "CHARLIE", "DELTA"]);
    screen.getByRole("listbox", { name: "Suggestions" });
  });

  it("moves the highlight with the arrow keys, round from either end", async () => {
    const { user, input, highlighted } = setup();
    await user.type(input, "a");
    expect(highlighted().textContent).toBe("onlineALPHA");
    expect(highlighted().classList).toContain("bg-muted");

    await user.keyboard("{ArrowUp}");
    expect(highlighted().textContent).toBe("DELTA");
    expect(highlighted().classList).toContain("bg-muted");
    expect(
      screen.getByRole("option", { name: /ALPHA/ }).classList,
    ).not.toContain("bg-muted");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(highlighted().textContent).toBe("BRAVO");
  });

  it("adds the highlighted callsign on Enter, emptying the field for the next one", async () => {
    vi.spyOn(api, "addMember").mockResolvedValue(null);
    const { user, input, names } = setup();
    await user.type(input, "a{ArrowDown}{Enter}");

    expect(api.addMember).toHaveBeenCalledWith(7, "BRAVO");
    expect(input.value).toBe("");
    expect(names()).toEqual([]);
    expect(document.activeElement).toBe(input);
  });

  it("puts the text back when the add fails", async () => {
    vi.spyOn(api, "addMember").mockRejectedValue(new Error("HTTP 502"));
    const { user, input } = setup();
    await user.type(input, "a{Enter}");

    expect(api.addMember).toHaveBeenCalledWith(7, "ALPHA");
    await waitFor(() => expect(input.value).toBe("a"));
  });

  it("adds a clicked callsign, focus back in the field", async () => {
    vi.spyOn(api, "addMember").mockResolvedValue(null);
    const { user, input } = setup();
    await user.type(input, "a");

    await user.click(screen.getByRole("option", { name: /CHARLIE/ }));
    expect(api.addMember).toHaveBeenCalledWith(7, "CHARLIE");
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("closes on Esc, the net staying open", async () => {
    const { user, input, onClose, outside } = setup();
    await user.type(input, "a");

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outside.mock.calls.some(([event]) => event.key === "Escape")).toBe(
      false,
    );
  });

  it("closes from its close button, Enter there included", async () => {
    const { user, input, onClose, run } = setup();
    await user.type(input, "a");
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close" }),
    );

    await user.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("says when no callsign matches", async () => {
    const { user, input } = setup();
    expect(screen.queryByRole("status")).toBeNull();

    await user.type(input, "ec");
    expect(screen.getByRole("status").textContent).toBe("No such callsign");
  });

  it("says what the first member does where the net is not members-only", () => {
    const hint = /Adding the first member makes this net members-only/;
    setup("open");
    expect(screen.getByText(hint)).toBeTruthy();
  });

  it("leaves that out on a members-only net", () => {
    setup("invite");
    expect(
      screen.queryByText(/Adding the first member makes this net/),
    ).toBeNull();
  });
});
