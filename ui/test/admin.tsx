// What the admin view's tests share: canned nets, users and missions, fake timers and layout, and lookups
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";

import { api, type Channel, type Mission, type User } from "../src/api";

export const net = (
  id: number,
  name: string,
  children: Channel[] = [],
): Channel => ({
  id,
  name,
  description: "",
  access: "open",
  members: [],
  children,
});
const user = (callsign: string, online: string[] = []): User => ({
  callsign,
  admin: false,
  revoked: false,
  voice_disabled: false,
  online,
});

export const CHANNELS = [
  net(1, "10", [net(2, "101"), net(3, "102")]),
  net(4, "20", [net(5, "201")]),
];
const USERS = [user("ALPHA", ["/Units/10/101"]), user("BRAVO")];
const MISSIONS: Mission[] = [
  { name: "PATROL", members: ["ALPHA"], open: false },
];
const TEMPLATES = [{ id: "a", name: "Plan A", description: "", nets: 3 }];

// A promise the test settles when it chooses
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

// The admin view's width as its ResizeObserver reports it; a test may narrow it
export const workspace = { width: 1000 };
class FakeResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe() {
    const entry = {
      contentRect: { width: workspace.width },
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

// Moves the clock on, then lets the fetches answer and React render
export const settle = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));
// Whole pointer sequences: a menu or a tab may act on the press rather than the click
export const pointer = () =>
  userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

export const row = (name: string) =>
  within(screen.getByTestId(`net-${name}`)).getAllByTestId("row")[0];
export const queryRow = (name: string) =>
  screen.queryByTestId(`net-${name}`) && row(name);

// Every admin test file calls this: fake timers, a wide workspace, and the canned answers above
export function fakeAdmin() {
  beforeEach(() => {
    vi.useFakeTimers();
    workspace.width = 1000;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    // jsdom lays nothing out
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(api, "channels").mockResolvedValue(CHANNELS);
    vi.spyOn(api, "users").mockResolvedValue(USERS);
    vi.spyOn(api, "missions").mockResolvedValue(MISSIONS);
    vi.spyOn(api, "templates").mockResolvedValue(TEMPLATES);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}
