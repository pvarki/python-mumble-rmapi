// The admin view's net tree: access rules, who is where, and search
import { describe, expect, it } from "vitest";

import type { Access, Channel, Mission, User } from "../src/api";
import {
  ancestors,
  deriveTree,
  focusAfterRemove,
  foldedAncestor,
  groupOnline,
  keyExists,
  parentOf,
  listUsers,
  ruleOf,
  suggest,
} from "../src/admin/tree";

// Access defaults to what older stores meant: members make a net invite-only, otherwise it follows
const net = (
  id: number,
  name: string,
  members: string[] = [],
  children: Channel[] = [],
  description = "",
  access: Access = members.length ? "invite" : "inherit",
): Channel => ({ id, name, description, access, members, children });
const user = (
  callsign: string,
  online: string[] = [],
  extra: Partial<User> = {},
): User => ({
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
const missions: Mission[] = [
  { name: "PATROL-NORTH", members: ["VOICE3", "tak.example"], open: false },
  { name: "RECON", members: ["VOICE1"], open: false },
];

describe("ruleOf", () => {
  it("covers the four rules", () => {
    const ten = { name: "10", invite: true };
    expect(ruleOf("open", ["10"], ten)).toEqual({ kind: "open" });
    expect(ruleOf("invite", [], null)).toEqual({ kind: "members" });
    expect(ruleOf("invite", ["10", "20"], ten)).toEqual({
      kind: "membersPlus",
      nets: ["10", "20"],
    });
    expect(ruleOf("inherit", ["10"], ten)).toEqual({
      kind: "follows",
      net: "10",
    });
    expect(ruleOf("inherit", ["10"], { name: "101", invite: false })).toEqual({
      kind: "open",
    });
    expect(ruleOf("inherit", [], null)).toEqual({ kind: "open" });
  });
});

describe("deriveTree", () => {
  const d = deriveTree(channels, users, missions, "");

  it("derives paths, depth and rules", () => {
    const n101 = d.byId.get(8);
    expect(n101?.path).toBe("/Units/10/101");
    expect(n101?.parentId).toBe(7);
    expect(n101?.depth).toBe(1);
    expect(n101?.rule).toEqual({ kind: "membersPlus", nets: ["10"] });
    expect(d.byId.get(9)?.rule).toEqual({ kind: "follows", net: "10" });
    expect(d.byId.get(7)?.rule).toEqual({ kind: "members" });
    expect(d.byId.get(1)?.rule).toEqual({ kind: "open" });
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
    expect(rules.get(2)?.rule).toEqual({ kind: "open" });
    expect(rules.get(3)?.rule).toEqual({ kind: "membersPlus", nets: ["10"] });
    expect(rules.get(4)?.rule).toEqual({ kind: "open" });
    expect(rules.get(6)?.rule).toEqual({ kind: "follows", net: "10" });
    expect(rules.get(3)?.above).toEqual({ name: "101", invite: false });
    expect(rules.get(6)?.above).toEqual({ name: "10", invite: true });
    expect(rules.get(1)?.above).toBeNull();
  });

  it("counts descendants and who is connected", () => {
    const n10 = d.byId.get(7);
    expect(n10?.descendants).toBe(2);
    expect(n10?.online).toEqual([]);
    expect(n10?.subtreeOnline).toBe(true);
    expect(d.byId.get(9)?.subtreeOnline).toBe(false);
    expect(d.byId.get(8)?.online).toEqual(["VOICE3"]);
    expect(d.whereOnline.get("VOICE3")).toEqual([
      "/Units/10/101",
      "/Missions/PATROL-NORTH",
    ]);
    expect(d.whereOnline.has("ALFA-JJ")).toBe(false);
  });

  it("totals nets and distinct callsigns online", () => {
    expect(d.unitCount).toBe(4);
    expect(d.unitMatches).toBe(4);
    expect(d.missionMatches).toBe(2);
    expect(d.unitsOnline).toBe(2);
    expect(d.missionsOnline).toBe(1);
    expect(d.presenceKnown).toBe(true);
  });

  it("marks mission subscribers that are not users", () => {
    const [patrol] = d.missions;
    expect(patrol.path).toBe("/Missions/PATROL-NORTH");
    expect(patrol.online).toEqual(["VOICE3"]);
    expect(patrol.subscribers).toEqual([
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
    expect(unknown.presenceKnown).toBe(false);
    expect(unknown.unitsOnline).toBe(0);
    expect(deriveTree([], [], [], "").presenceKnown).toBe(false);
  });

  it("keeps ancestors of a match visible as context", () => {
    const s = deriveTree(channels, users, missions, " voice3 ");
    const n10 = s.byId.get(7);
    expect(n10?.match).toBe(false);
    expect(n10?.visible).toBe(true);
    expect(s.byId.get(8)?.match).toBe(true);
    expect(s.byId.get(9)?.visible).toBe(false);
    expect(s.byId.get(1)?.visible).toBe(false);
    expect(s.unitMatches).toBe(1);
    expect(s.unitsOnline).toBe(1);
    expect(
      s.missions.filter((m) => m.match).map((m) => m.mission.name),
    ).toEqual(["PATROL-NORTH"]);
  });

  it("matches names, descriptions, members and connected callsigns", () => {
    const hits = (q: string) =>
      [...deriveTree(channels, users, missions, q).byId.values()]
        .filter((n) => n.match)
        .map((n) => n.channel.name);
    expect(hits("tike")).toEqual(["00A TIKE"]);
    expect(hits("PÄIVYS")).toEqual(["00A TIKE"]);
    expect(hits("voice1")).toEqual(["00A TIKE", "10"]);
    expect(hits("nothing")).toEqual([]);
    const m = deriveTree(channels, users, missions, "recon").missions;
    expect(m.map((x) => x.match)).toEqual([false, true]);
  });
});

describe("listUsers", () => {
  it("lists non-revoked users A–Z, filtered by callsign", () => {
    expect(listUsers(users, "").map((u) => u.callsign)).toEqual([
      "ALFA-JJ",
      "VOICE1",
      "VOICE3",
    ]);
    expect(listUsers(users, "voice").map((u) => u.callsign)).toEqual([
      "VOICE1",
      "VOICE3",
    ]);
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
    expect(suggest(people, [], " ")).toEqual([]);
    expect(
      suggest(people, ["ALFA-JJ"], "alfa-").map((u) => u.callsign),
    ).toEqual(["ALFA-R1", "ALFA-R2", "ALFA-R3"]);
  });
  it("caps the list", () => {
    expect(suggest(people, [], "alfa", 2)).toHaveLength(2);
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
    expect(focusAfterRemove(roots[0].children[0], roots)).toBe(1);
  });
  it("focuses the next top-level net, else the previous, else none", () => {
    expect(focusAfterRemove(roots[1], roots)).toBe(3);
    expect(focusAfterRemove(roots[2], roots)).toBe(2);
    expect(focusAfterRemove(roots[0], roots.slice(0, 1))).toBeNull();
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
    expect(ancestors(111, byId)).toEqual([1, 11]);
    expect(ancestors(1, byId)).toEqual([]);
    expect(ancestors(99, byId)).toEqual([]);
  });
  it("finds the first folded ancestor from the top", () => {
    const folded = (ids: number[]) => (id: number) => !ids.includes(id);
    expect(foldedAncestor(111, byId, folded([]))).toBeNull();
    expect(foldedAncestor(111, byId, folded([11]))).toBe(11);
    expect(foldedAncestor(111, byId, folded([1, 11]))).toBe(1);
    expect(foldedAncestor(1, byId, folded([1]))).toBeNull();
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
    expect(groupOnline(d.roots[0])).toBe(2);
    expect(groupOnline(d.roots[0].children[1])).toBe(1);
    expect(groupOnline(deriveTree([net(5, "E")], [], [], "").roots[0])).toBe(0);
  });
});

describe("parentOf and keyExists", () => {
  it("finds a channel's parent anywhere in the tree", () => {
    expect(parentOf(channels, 7)).toBe(0);
    expect(parentOf(channels, 9)).toBe(7);
    expect(parentOf(channels, 99)).toBeNull();
  });
  it("checks unit and mission keys against fresh data", () => {
    expect(keyExists("u:8", channels, missions)).toBe(true);
    expect(keyExists("u:99", channels, missions)).toBe(false);
    expect(keyExists("m:RECON", channels, missions)).toBe(true);
    expect(keyExists("m:GONE", channels, missions)).toBe(false);
  });
});
