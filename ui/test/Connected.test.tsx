// The net picker on the talk panel: what it shows, joining a net with the pointer or the keyboard, and a
// push-to-talk key held while the picker has focus
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { Net, Person, Snapshot, VoiceClient } from "../src/voice/client";
import { Connected } from "../src/voice/Connected";
import { DEFAULT_BINDING, type Binding } from "../src/voice/ptt";
import { usePushToTalk } from "../src/voice/usePushToTalk";

// Radix Select calls these, which jsdom lacks
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const net = (id: number, parent: number, name: string, canEnter = true) =>
  [id, { id, parent, name, canEnter }] as [number, Net];
const NETS = new Map([
  net(0, 0, "Root"),
  net(1, 0, "Units"),
  net(2, 1, "10", false), // members only; this user is a member of one below it
  net(3, 2, "101"),
  net(4, 1, "20"),
  net(5, 0, "Missions"),
  net(6, 5, "Guard"),
]);
const person = (session: number, name: string, channel: number): Person => ({
  session,
  name,
  channel,
  mute: false,
  suppress: false,
});

const choose = () => {};

// The panel as Talk shows it, with push-to-talk listening
function Panel({ client, binding }: { client: VoiceClient; binding: Binding }) {
  usePushToTalk(client, binding, false, choose);
  return (
    <Connected
      client={client}
      s={client.getSnapshot()}
      binding={binding}
      choosing={false}
      choose={choose}
    />
  );
}

function setup(
  channel: number,
  binding: Binding = DEFAULT_BINDING,
  denied: string | null = null,
) {
  const s: Snapshot = {
    phase: "connected",
    failure: null,
    detail: "",
    self: 1,
    nets: NETS,
    people: new Map([
      [1, person(1, "VOICE1---web-1", channel)],
      [2, person(2, "VOICE2---vs1", 6)],
    ]),
    talking: new Set(),
    transmitting: false,
    denied,
  };
  const client = {
    join: vi.fn(),
    talk: vi.fn(),
    disconnect: vi.fn(),
    getSnapshot: () => s,
  };
  render(<Panel client={client as unknown as VoiceClient} binding={binding} />);
  const picker = screen.getByRole("combobox", { name: "Voice net" });
  return { user: userEvent.setup(), client, picker };
}

describe("the net picker", () => {
  it("shows the joined net's path, and the PTT button is ready", () => {
    const { picker } = setup(3);
    expect(picker.textContent).toBe("Units › 10 › 101");
    expect(
      screen.getByRole("button", { name: "Hold and talk" }),
    ).not.toHaveProperty("disabled", true);
  });

  it("asks for a net before the user is in one, with the PTT button off", () => {
    const { picker } = setup(0);
    expect(picker.textContent).toBe("Pick a net");
    expect(
      screen.getByRole("button", { name: "Hold and talk" }),
    ).toHaveProperty("disabled", true);
  });

  it.each([
    ["Members only", "Members only"],
    ["", "You may not enter that net."],
  ])("says why the server refused a net: %j", (denied, said) => {
    setup(3, DEFAULT_BINDING, denied);
    expect(screen.getByRole("alert").textContent).toBe(said);
  });

  it("lists the nets under their groups, with closed nets above as context only", async () => {
    const { user, picker } = setup(3);
    await user.click(picker);

    const listbox = screen.getByRole("listbox");
    const groups = within(listbox).getAllByRole("group");
    expect(groups.map((g) => within(g).getAllByRole("option").length)).toEqual([
      3, 1,
    ]);
    expect(within(groups[0]).getByText("Units")).toBeTruthy();
    const option = (name: RegExp) =>
      within(listbox).getByRole("option", { name });
    expect(option(/^10$/).getAttribute("aria-disabled")).toBe("true");
    expect(option(/^101/).getAttribute("aria-selected")).toBe("true");
    expect(option(/^Guard/).textContent).toBe("Guard1 person");
  });

  it("joins the net clicked", async () => {
    const { user, client, picker } = setup(3);
    await user.click(picker);
    await user.click(screen.getByRole("option", { name: /^Guard/ }));

    expect(client.join).toHaveBeenCalledWith(6);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("joins from the keyboard, skipping the closed net", async () => {
    const { user, client, picker } = setup(4);
    picker.focus();

    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: /^20/ }),
    );
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(
      screen.getByRole("option", { name: /^101/ }),
    );
    await user.keyboard("{Enter}");

    expect(client.join).toHaveBeenCalledWith(3);
    expect(document.activeElement).toBe(picker);
  });

  it("leaves the picker alone while a digit bound to push-to-talk is held", async () => {
    const { user, client, picker } = setup(3, { kind: "key", code: "Digit2" });
    picker.focus();

    await user.keyboard("[Digit2>3]");
    expect(client.talk).toHaveBeenLastCalledWith(true);
    await user.keyboard("[/Digit2]");
    expect(client.talk).toHaveBeenLastCalledWith(false);
    expect(client.join).not.toHaveBeenCalled();
    expect(picker.textContent).toBe("Units › 10 › 101");
  });

  it("does not open the list for Space bound to push-to-talk", async () => {
    const { user, client, picker } = setup(3, { kind: "key", code: "Space" });
    picker.focus();

    await user.keyboard("[Space>][/Space]");
    expect(client.talk.mock.calls).toEqual([[true], [false]]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
