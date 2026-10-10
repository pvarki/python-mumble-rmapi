// Unit tests for the pure derivations in src/paths.ts. Node strips the types itself: `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ancestors,
  deriveTree,
  focusAfterRemove,
  foldedAncestor,
  groupOnline,
  keyExists,
  parentOf,
  listUsers,
  pathLabel,
  ruleOf,
  suggest,
} from "../src/paths.ts";

// Access defaults to what older stores meant: members make a net invite-only, otherwise it follows
const net = (
  id,
  name,
  members = [],
  children = [],
  description = "",
  access = members.length ? "invite" : "inherit",
) => ({ id, name, description, access, members, children });
const user = (callsign, online = [], extra = {}) => ({
  callsign,
  admin: false,
  revoked: false,
  voice_disabled: false,
  online,
  ...extra,
});

// A company slice: open HQ net, restricted platoon 10 with a restricted and a following squad
const channels = [
  net(1, "00A TIKE", [], [], "Tilannepäivystys"),
  net(
    7,
    "10",
    ["VOICE1"],
    [net(8, "101", ["VOICE3"], [], "Alfa-Ryhmä1"), net(9, "102")],
  ),
];
const users = [
  user("VOICE1", ["/Units/00A TIKE"]),
  user("VOICE3", ["/Units/10/101", "/Missions/PATROL-NORTH"]),
  user("ALFA-JJ"),
  user("GONE", [], { revoked: true }),
];
const missions = [
  { name: "PATROL-NORTH", members: ["VOICE3", "tak.example"] },
  { name: "RECON", members: ["VOICE1"] },
];

describe("pathLabel", () => {
  it("drops the Units and Missions roots", () => {
    assert.equal(pathLabel("/Units/10/101"), "10 › 101");
    assert.equal(pathLabel("/Missions/PATROL-NORTH"), "PATROL-NORTH");
  });
  it("joins any other path", () => {
    assert.equal(pathLabel("/Teams/Red"), "Teams › Red");
    assert.equal(pathLabel("/Units"), "Units");
  });
});

describe("ruleOf", () => {
  it("covers the four rules", () => {
    const ten = { name: "10", invite: true };
    assert.deepEqual(ruleOf("open", ["10"], ten), { kind: "open" });
    assert.deepEqual(ruleOf("invite", [], null), { kind: "members" });
    assert.deepEqual(ruleOf("invite", ["10", "20"], ten), {
      kind: "membersPlus",
      nets: ["10", "20"],
    });
    assert.deepEqual(ruleOf("inherit", ["10"], ten), {
      kind: "follows",
      net: "10",
    });
    assert.deepEqual(
      ruleOf("inherit", ["10"], { name: "101", invite: false }),
      {
        kind: "open",
      },
    );
    assert.deepEqual(ruleOf("inherit", [], null), { kind: "open" });
  });
});

describe("deriveTree", () => {
  const d = deriveTree(channels, users, missions, "");

  it("derives paths, depth and rules", () => {
    const n101 = d.byId.get(8);
    assert.equal(n101.path, "/Units/10/101");
    assert.equal(n101.parentId, 7);
    assert.equal(n101.depth, 1);
    assert.deepEqual(n101.rule, { kind: "membersPlus", nets: ["10"] });
    assert.deepEqual(d.byId.get(9).rule, { kind: "follows", net: "10" });
    assert.deepEqual(d.byId.get(7).rule, { kind: "members" });
    assert.deepEqual(d.byId.get(1).rule, { kind: "open" });
  });

  it("follows each net's access through open nets", () => {
    // 10 members-only > 101 open > 1011 members-only and 1012 inherit; 102 inherit > 1021 inherit
    const tree = [
      net(
        1,
        "10",
        ["LEAD"],
        [
          net(
            2,
            "101",
            ["KEPT"],
            [net(3, "1011", [], [], "", "invite"), net(4, "1012")],
            "",
            "open",
          ),
          net(5, "102", [], [net(6, "1021")]),
        ],
      ),
    ];
    const rules = deriveTree(tree, [], [], "").byId;
    assert.deepEqual(rules.get(2).rule, { kind: "open" });
    assert.deepEqual(rules.get(3).rule, { kind: "membersPlus", nets: ["10"] });
    assert.deepEqual(rules.get(4).rule, { kind: "open" });
    assert.deepEqual(rules.get(6).rule, { kind: "follows", net: "10" });
    assert.deepEqual(rules.get(3).above, { name: "101", invite: false });
    assert.deepEqual(rules.get(6).above, { name: "10", invite: true });
    assert.equal(rules.get(1).above, null);
  });

  it("counts descendants and who is connected", () => {
    const n10 = d.byId.get(7);
    assert.equal(n10.descendants, 2);
    assert.deepEqual(n10.online, []);
    assert.equal(n10.subtreeOnline, true);
    assert.equal(d.byId.get(9).subtreeOnline, false);
    assert.deepEqual(d.byId.get(8).online, ["VOICE3"]);
    assert.deepEqual(d.whereOnline.get("VOICE3"), [
      "/Units/10/101",
      "/Missions/PATROL-NORTH",
    ]);
    assert.equal(d.whereOnline.has("ALFA-JJ"), false);
  });

  it("totals nets and distinct callsigns online", () => {
    assert.equal(d.unitCount, 4);
    assert.equal(d.unitMatches, 4);
    assert.equal(d.missionMatches, 2);
    assert.equal(d.unitsOnline, 2);
    assert.equal(d.missionsOnline, 1);
    assert.equal(d.presenceKnown, true);
  });

  it("marks mission subscribers that are not users", () => {
    const [patrol] = d.missions;
    assert.equal(patrol.path, "/Missions/PATROL-NORTH");
    assert.deepEqual(patrol.online, ["VOICE3"]);
    assert.deepEqual(patrol.subscribers, [
      { callsign: "VOICE3", known: true, online: true },
      { callsign: "tak.example", known: false, online: false },
    ]);
  });

  it("reports unknown presence when every user's online is null", () => {
    const unknown = deriveTree(
      channels,
      users.map((u) => ({ ...u, online: null })),
      missions,
      "",
    );
    assert.equal(unknown.presenceKnown, false);
    assert.equal(unknown.unitsOnline, 0);
    assert.equal(deriveTree([], [], [], "").presenceKnown, false);
  });

  it("keeps ancestors of a match visible as context", () => {
    const s = deriveTree(channels, users, missions, " voice3 ");
    const n10 = s.byId.get(7);
    assert.equal(n10.match, false);
    assert.equal(n10.visible, true);
    assert.equal(s.byId.get(8).match, true);
    assert.equal(s.byId.get(9).visible, false);
    assert.equal(s.byId.get(1).visible, false);
    assert.equal(s.unitMatches, 1);
    assert.equal(s.unitsOnline, 1);
    assert.deepEqual(
      s.missions.filter((m) => m.match).map((m) => m.mission.name),
      ["PATROL-NORTH"],
    );
  });

  it("matches names, descriptions, members and connected callsigns", () => {
    const hits = (q) =>
      [...deriveTree(channels, users, missions, q).byId.values()]
        .filter((n) => n.match)
        .map((n) => n.channel.name);
    assert.deepEqual(hits("tike"), ["00A TIKE"]);
    assert.deepEqual(hits("PÄIVYS"), ["00A TIKE"]);
    assert.deepEqual(hits("voice1"), ["00A TIKE", "10"]);
    assert.deepEqual(hits("nothing"), []);
    const m = deriveTree(channels, users, missions, "recon").missions;
    assert.deepEqual(
      m.map((x) => x.match),
      [false, true],
    );
  });
});

describe("listUsers", () => {
  it("lists non-revoked users A–Z, filtered by callsign", () => {
    assert.deepEqual(
      listUsers(users, "").map((u) => u.callsign),
      ["ALFA-JJ", "VOICE1", "VOICE3"],
    );
    assert.deepEqual(
      listUsers(users, "voice").map((u) => u.callsign),
      ["VOICE1", "VOICE3"],
    );
  });
});

describe("suggest", () => {
  const people = [
    user("ALFA-R3"),
    user("ALFA-R1", ["/Units/10"]),
    user("ALFA-R2"),
    user("ALFA-JJ"),
    user("ALFA-X", [], { revoked: true }),
  ];
  it("needs text, skips members and revoked, puts online first", () => {
    assert.deepEqual(suggest(people, [], " "), []);
    assert.deepEqual(
      suggest(people, ["ALFA-JJ"], "alfa-").map((u) => u.callsign),
      ["ALFA-R1", "ALFA-R2", "ALFA-R3"],
    );
  });
  it("caps the list", () => {
    assert.equal(suggest(people, [], "alfa", 2).length, 2);
  });
});

describe("focusAfterRemove", () => {
  const roots = deriveTree(
    [net(1, "A", [], [net(11, "A1")]), net(2, "B"), net(3, "C")],
    [],
    [],
    "",
  ).roots;
  it("focuses the parent of a sub-net", () => {
    assert.equal(focusAfterRemove(roots[0].children[0], roots), 1);
  });
  it("focuses the next top-level net, else the previous, else none", () => {
    assert.equal(focusAfterRemove(roots[1], roots), 3);
    assert.equal(focusAfterRemove(roots[2], roots), 2);
    assert.equal(focusAfterRemove(roots[0], roots.slice(0, 1)), null);
  });
});

describe("ancestors and foldedAncestor", () => {
  const { byId } = deriveTree(
    [net(1, "A", [], [net(11, "A1", [], [net(111, "A11")])]), net(2, "B")],
    [],
    [],
    "",
  );
  it("lists ancestors top-down, without the net itself", () => {
    assert.deepEqual(ancestors(111, byId), [1, 11]);
    assert.deepEqual(ancestors(1, byId), []);
    assert.deepEqual(ancestors(99, byId), []);
  });
  it("finds the first folded ancestor from the top", () => {
    const folded = (ids) => (id) => !ids.includes(id);
    assert.equal(foldedAncestor(111, byId, folded([])), null);
    assert.equal(foldedAncestor(111, byId, folded([11])), 11);
    assert.equal(foldedAncestor(111, byId, folded([1, 11])), 1);
    assert.equal(foldedAncestor(1, byId, folded([1])), null);
  });
});

describe("groupOnline", () => {
  it("counts distinct callsigns in a net and its sub-nets", () => {
    const d = deriveTree(
      [net(1, "A", [], [net(11, "A1"), net(12, "A2")])],
      [
        user("X", ["/Units/A", "/Units/A/A1"]),
        user("Y", ["/Units/A/A2"]),
        user("Z"),
      ],
      [],
      "",
    );
    assert.equal(groupOnline(d.byId.get(1)), 2);
    assert.equal(groupOnline(d.byId.get(12)), 1);
    assert.equal(
      groupOnline(deriveTree([net(5, "E")], [], [], "").byId.get(5)),
      0,
    );
  });
});

describe("parentOf and keyExists", () => {
  it("finds a channel's parent anywhere in the tree", () => {
    assert.equal(parentOf(channels, 7), 0);
    assert.equal(parentOf(channels, 9), 7);
    assert.equal(parentOf(channels, 99), null);
  });
  it("checks unit and mission keys against fresh data", () => {
    assert.equal(keyExists("u:8", channels, missions), true);
    assert.equal(keyExists("u:99", channels, missions), false);
    assert.equal(keyExists("m:RECON", channels, missions), true);
    assert.equal(keyExists("m:GONE", channels, missions), false);
  });
});
