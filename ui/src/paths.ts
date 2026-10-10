// Pure derivations every view reads: net labels, each unit net's effective access rule, who is where, and
// search. No imports at runtime, so `node --test` can load this file directly.
import type { Access, Channel, Mission, User } from "./api";

export const UNITS = "/Units/";
export const MISSIONS = "/Missions/";

// '/Units/10/101' -> '10 › 101', '/Missions/X' -> 'X', anything else -> its segments joined
export function pathLabel(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1 && (parts[0] === "Units" || parts[0] === "Missions")) {
    parts.shift();
  }
  return parts.join(" › ");
}

// Who may use a net, from its access and the nets above it. A members-only net admits its members and those
// of every members-only net above it, even across open nets in between; an inherit net follows the nearest net
// above that sets its own access, which at the top level means open.
export type Rule =
  | { kind: "open" }
  | { kind: "members" }
  | { kind: "membersPlus"; nets: string[] }
  | { kind: "follows"; net: string };

export interface NetNode {
  channel: Channel;
  path: string;
  parentId: number;
  depth: number;
  rule: Rule;
  // The nearest net above that sets its own access: what 'inherit' would follow
  above: Setter | null;
  // Callsigns connected to this net now
  online: string[];
  descendants: number;
  subtreeOnline: boolean;
  // Matches the search (always true without one); a visible node that does not match is context only
  match: boolean;
  visible: boolean;
  children: NetNode[];
}

export interface Subscriber {
  callsign: string;
  known: boolean;
  online: boolean;
}

export interface MissionNode {
  mission: Mission;
  path: string;
  online: string[];
  subscribers: Subscriber[];
  match: boolean;
}

export interface Derived {
  roots: NetNode[];
  byId: Map<number, NetNode>;
  missions: MissionNode[];
  unitCount: number;
  // Matching nets and missions, and the distinct callsigns connected in them
  unitMatches: number;
  missionMatches: number;
  unitsOnline: number;
  missionsOnline: number;
  // False when the voice server has stopped reporting presence
  presenceKnown: boolean;
  // Callsign to the nets it is connected to, for users that are online somewhere
  whereOnline: Map<string, string[]>;
}

const contains = (text: string, q: string) => text.toLowerCase().includes(q);

// The nearest net above that sets its own access, which an inherit net follows
export interface Setter {
  name: string;
  invite: boolean;
}

export function ruleOf(
  access: Access,
  invitesAbove: string[],
  nearest: Setter | null,
): Rule {
  if (access === "invite") {
    return invitesAbove.length
      ? { kind: "membersPlus", nets: invitesAbove }
      : { kind: "members" };
  }
  return access === "inherit" && nearest?.invite
    ? { kind: "follows", net: nearest.name }
    : { kind: "open" };
}

export function deriveTree(
  channels: Channel[],
  users: User[],
  missions: Mission[],
  query: string,
): Derived {
  const q = query.trim().toLowerCase();
  const byPath = new Map<string, string[]>();
  const whereOnline = new Map<string, string[]>();
  for (const user of users) {
    if (!user.online?.length) continue;
    whereOnline.set(user.callsign, user.online);
    for (const path of user.online) {
      byPath.set(path, [...(byPath.get(path) ?? []), user.callsign]);
    }
  }
  const byId = new Map<number, NetNode>();

  const build = (
    channel: Channel,
    parentId: number,
    parentPath: string,
    depth: number,
    invites: string[],
    nearest: Setter | null,
  ): NetNode => {
    const path = `${parentPath}${channel.name}`;
    const online = (byPath.get(path) ?? []).slice().sort();
    const { access } = channel;
    const below = access === "invite" ? [...invites, channel.name] : invites;
    const setter =
      access === "inherit"
        ? nearest
        : { name: channel.name, invite: access === "invite" };
    const children = channel.children.map((child) =>
      build(child, channel.id, `${path}/`, depth + 1, below, setter),
    );
    const match =
      !q ||
      contains(channel.name, q) ||
      contains(channel.description, q) ||
      channel.members.some((m) => contains(m, q)) ||
      online.some((m) => contains(m, q));
    const node: NetNode = {
      channel,
      path,
      parentId,
      depth,
      rule: ruleOf(access, invites, nearest),
      above: nearest,
      online,
      descendants: children.reduce((n, c) => n + 1 + c.descendants, 0),
      subtreeOnline: online.length > 0 || children.some((c) => c.subtreeOnline),
      match,
      visible: match || children.some((c) => c.visible),
      children,
    };
    byId.set(channel.id, node);
    return node;
  };
  const roots = channels.map((c) => build(c, 0, UNITS, 0, [], null));

  const known = new Set(users.map((u) => u.callsign));
  const missionNodes = missions.map((mission): MissionNode => {
    const path = `${MISSIONS}${mission.name}`;
    const online = (byPath.get(path) ?? []).slice().sort();
    return {
      mission,
      path,
      online,
      subscribers: mission.members.map((callsign) => ({
        callsign,
        known: known.has(callsign),
        online: whereOnline.has(callsign),
      })),
      match:
        !q ||
        contains(mission.name, q) ||
        mission.members.some((m) => contains(m, q)) ||
        online.some((m) => contains(m, q)),
    };
  });

  const matching = [...byId.values()].filter((n) => n.match);
  const shownMissions = missionNodes.filter((m) => m.match);
  const distinct = (lists: string[][]) => new Set(lists.flat()).size;
  return {
    roots,
    byId,
    missions: missionNodes,
    unitCount: byId.size,
    unitMatches: matching.length,
    missionMatches: shownMissions.length,
    unitsOnline: distinct(matching.map((n) => n.online)),
    missionsOnline: distinct(shownMissions.map((m) => m.online)),
    presenceKnown: users.some((u) => u.online !== null),
    whereOnline,
  };
}

// The Käyttäjät list: non-revoked users matching the search, A–Z, so presence never moves a row
export function listUsers(users: User[], query: string): User[] {
  const q = query.trim().toLowerCase();
  return users
    .filter((u) => !u.revoked && contains(u.callsign, q))
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
}

// Member suggestions: up to 8 non-revoked non-members containing the text, online first, then A–Z
export function suggest(
  users: User[],
  members: string[],
  text: string,
  limit = 8,
): User[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(members);
  const online = (u: User) => (u.online?.length ? 0 : 1);
  return users
    .filter(
      (u) => !u.revoked && !taken.has(u.callsign) && contains(u.callsign, q),
    )
    .sort(
      (a, b) => online(a) - online(b) || a.callsign.localeCompare(b.callsign),
    )
    .slice(0, limit);
}

// The row that takes focus after a net is removed: its parent, or at the top level the next (else previous)
// visible net. Null when it was the last one.
export function focusAfterRemove(
  node: NetNode,
  roots: NetNode[],
): number | null {
  if (node.parentId) return node.parentId;
  const shown = roots.filter((r) => r.visible);
  const i = shown.indexOf(node);
  return (shown[i + 1] ?? shown[i - 1])?.channel.id ?? null;
}

// The ancestors of a net, top-down, without the net itself
export function ancestors(id: number, byId: Map<number, NetNode>): number[] {
  const out: number[] = [];
  for (
    let node = byId.get(id);
    node?.parentId;
    node = byId.get(node.parentId)
  ) {
    out.unshift(node.parentId);
  }
  return out;
}

// The first folded ancestor from the top, whose header stands in for a net hidden by a fold; null when the
// net's row is visible
export function foldedAncestor(
  id: number,
  byId: Map<number, NetNode>,
  isExpanded: (id: number) => boolean,
): number | null {
  return ancestors(id, byId).find((a) => !isExpanded(a)) ?? null;
}

// Distinct callsigns connected in a net and all its sub-nets, for a folded row
export function groupOnline(node: NetNode): number {
  const seen = new Set<string>();
  const walk = (n: NetNode) => {
    n.online.forEach((callsign) => seen.add(callsign));
    n.children.forEach(walk);
  };
  walk(node);
  return seen.size;
}

// The parent id of a channel in a channel tree (0 at the top level), or null when it is not there
export function parentOf(
  channels: Channel[],
  id: number,
  parent = 0,
): number | null {
  for (const channel of channels) {
    if (channel.id === id) return parent;
    const found = parentOf(channel.children, id, channel.id);
    if (found !== null) return found;
  }
  return null;
}

// Whether an open key ('u:<channel id>' or 'm:<mission name>') still names a net in freshly fetched data
export function keyExists(
  key: string,
  channels: Channel[],
  missions: Mission[],
): boolean {
  if (key.startsWith("m:")) {
    return missions.some((m) => m.name === key.slice(2));
  }
  return parentOf(channels, Number(key.slice(2))) !== null;
}
