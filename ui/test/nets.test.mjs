// Unit tests for the talk panel's net list: `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callsignOf, isBrowser, netPath, netRows } from "../src/voice/nets.ts";

const net = (id, parent, name, canEnter = true) => [
  id,
  { id, parent, name, canEnter },
];
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
const PEOPLE = new Map([
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
    assert.deepEqual(
      rows.map((r) => [r.path, r.depth, r.joinable, r.count]),
      [
        ["Units", 0, false, 0],
        ["Units › 00 Tehtäväkanavat", 1, false, 0],
        ["Units › 00 Tehtäväkanavat › 00A TIKE", 2, true, 2],
        ["Units › 2", 1, true, 0],
        ["Units › 10", 1, true, 0],
        ["Missions", 0, false, 0],
        ["Missions › Guard", 1, true, 1],
        ["Extra", 0, false, 0],
        ["Extra › x", 1, true, 0],
      ],
    );
  });
  it("is empty before Murmur has sent anything", () => {
    assert.deepEqual(netRows(new Map(), new Map()), []);
  });
});

describe("netPath", () => {
  it("names a net from the top, without Murmur's root", () => {
    assert.equal(netPath(NETS, 3), "Units › 00 Tehtäväkanavat › 00A TIKE");
    assert.equal(netPath(NETS, 0), "");
    assert.equal(netPath(NETS, 99), "");
  });
  it("stops on a loop", () => {
    const loop = new Map([net(1, 2, "a"), net(2, 1, "b")]);
    assert.ok(netPath(loop, 1).split(" › ").length <= 33);
  });
});

describe("usernames", () => {
  it("show the callsign and tell browsers from phones", () => {
    assert.equal(callsignOf("VOICE_1---web-2"), "VOICE 1");
    assert.equal(callsignOf("BARE"), "BARE");
    assert.ok(isBrowser("A---web-1") && isBrowser("A---WEB-9"));
    assert.ok(!isBrowser("A---vs1") && !isBrowser("A"));
  });
});
