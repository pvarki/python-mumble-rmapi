// The talk panel's view of Murmur's channel tree. Only type imports, so `node --test` can load this file.
import type { Net, Person } from "./client";

export interface NetRow {
  id: number;
  name: string;
  path: string; // "Units › 00 Tehtäväkanavat › 00A TIKE"
  depth: number; // 0 for the top-level groups: Units, Missions, Teams, Roles
  joinable: boolean; // false for a net shown only because one inside it is open to this user
  count: number; // people in it now
}

const byName = (a: Net, b: Net) =>
  a.name.localeCompare(b.name, undefined, { numeric: true });
// The groups in the order people use them; anything else after them, by name
const GROUPS = ["Units", "Missions", "Teams", "Roles"];
const rank = (net: Net) => {
  const i = GROUPS.indexOf(net.name);
  return i < 0 ? GROUPS.length : i;
};
const byGroup = (a: Net, b: Net) => rank(a) - rank(b) || byName(a, b);

// Every net this user may enter, with the nets above them for context, depth first. Murmur's root is left out.
export function netRows(
  nets: ReadonlyMap<number, Net>,
  people: ReadonlyMap<number, Person>,
): NetRow[] {
  const children = new Map<number, Net[]>();
  for (const net of nets.values()) {
    if (net.id === 0) continue;
    const list = children.get(net.parent) ?? [];
    list.push(net);
    children.set(net.parent, list);
  }
  const counts = new Map<number, number>();
  for (const p of people.values())
    counts.set(p.channel, (counts.get(p.channel) ?? 0) + 1);

  const walk = (parent: number, depth: number, above: string): NetRow[] =>
    (children.get(parent) ?? [])
      .sort(parent === 0 ? byGroup : byName)
      .flatMap((net) => {
        const path = above ? `${above} › ${net.name}` : net.name;
        const below = walk(net.id, depth + 1, path);
        if (!net.canEnter && below.length === 0) return [];
        const row = {
          id: net.id,
          name: net.name,
          path,
          depth,
          joinable: net.canEnter && depth > 0,
          count: counts.get(net.id) ?? 0,
        };
        return [row, ...below];
      });
  return walk(0, 0, "");
}

// The path of a net, for the "you are in" line; "" for Murmur's root
export function netPath(nets: ReadonlyMap<number, Net>, id: number): string {
  const names: string[] = [];
  for (
    let net = nets.get(id);
    net && net.id !== 0;
    net = nets.get(net.parent)
  ) {
    names.unshift(net.name);
    if (names.length > 32) break; // a loop in a broken tree
  }
  return names.join(" › ");
}

// "VOICE_1---web-2" -> "VOICE 1"; the slot says which device, not who
export const callsignOf = (username: string): string =>
  username.split("---")[0].replace(/_/g, " ");

export const isBrowser = (username: string): boolean =>
  /---web-\d$/i.test(username);
