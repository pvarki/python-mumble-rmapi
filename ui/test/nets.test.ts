// The talk panel's net list
import { describe, expect, it } from "vitest";

import type { Net, Person } from "../src/voice/client";
import {
  callsignOf,
  isBrowser,
  netGroups,
  netPath,
  netRows,
} from "../src/voice/nets";

const net = (
  id: number,
  parent: number,
  name: string,
  canEnter = true,
): [number, Net] => [id, { id, parent, name, canEnter }];
const NETS = new Map([
  net(0, 0, "Root"),
  net(1, 0, "Units"),
  net(2, 1, "00 Tehtäväkanavat", false), // members only; this user is not a member
  net(3, 2, "00A TIKE"), // ...but is one here
  net(4, 2, "00B", false),
  net(5, 1, "10"),
  net(6, 1, "2"),
  net(7, 0, "Missions"),
  net(8, 7, "Guard"),
  net(9, 7, "RECON", false),
  net(10, 0, "Hidden", false),
  net(11, 0, "Extra"), // not one of the known groups: after them
  net(12, 11, "x"),
]);
const PEOPLE = new Map<number, Person>([
  [
    1,
    {
      session: 1,
      name: "VOICE1---web-1",
      channel: 3,
      mute: false,
      suppress: false,
    },
  ],
  [
    2,
    {
      session: 2,
      name: "VOICE3---vs1",
      channel: 3,
      mute: false,
      suppress: false,
    },
  ],
  [
    3,
    { session: 3, name: "X---vs1", channel: 8, mute: false, suppress: false },
  ],
]);

describe("netRows", () => {
  it("lists what the user may enter, units first, with closed nets above them as context", () => {
    const rows = netRows(NETS, PEOPLE);
    expect(rows.map((r) => [r.path, r.depth, r.joinable, r.count])).toEqual([
      ["Units", 0, false, 0],
      ["Units › 00 Tehtäväkanavat", 1, false, 0],
      ["Units › 00 Tehtäväkanavat › 00A TIKE", 2, true, 2],
      ["Units › 2", 1, true, 0],
      ["Units › 10", 1, true, 0],
      ["Missions", 0, false, 0],
      ["Missions › Guard", 1, true, 1],
      ["Extra", 0, false, 0],
      ["Extra › x", 1, true, 0],
    ]);
  });
  it("is empty before Murmur has sent anything", () => {
    expect(netRows(new Map(), new Map())).toEqual([]);
  });
});

describe("netGroups", () => {
  it("puts each net under the top-level group above it, keeping the order", () => {
    const groups = netGroups(netRows(NETS, PEOPLE));
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.name)])).toEqual([
      ["Units", ["00 Tehtäväkanavat", "00A TIKE", "2", "10"]],
      ["Missions", ["Guard"]],
      ["Extra", ["x"]],
    ]);
  });
  it("is empty without rows", () => {
    expect(netGroups([])).toEqual([]);
  });
});

describe("netPath", () => {
  it("names a net from the top, without Murmur's root", () => {
    expect(netPath(NETS, 3)).toBe("Units › 00 Tehtäväkanavat › 00A TIKE");
    expect(netPath(NETS, 0)).toBe("");
    expect(netPath(NETS, 99)).toBe("");
  });
  it("stops on a loop", () => {
    const loop = new Map([net(1, 2, "a"), net(2, 1, "b")]);
    expect(netPath(loop, 1).split(" › ").length).toBeLessThanOrEqual(33);
  });
});

describe("usernames", () => {
  it("show the callsign and tell browsers from phones", () => {
    expect(callsignOf("VOICE_1---web-2")).toBe("VOICE 1");
    expect(callsignOf("BARE")).toBe("BARE");
    expect(isBrowser("A---web-1") && isBrowser("A---WEB-9")).toBe(true);
    expect(!isBrowser("A---vs1") && !isBrowser("A")).toBe(true);
  });
});
