// The admin API, published by Traefik on rmui's own origin. The browser's client certificate identifies the
// caller, and mumblermapi refuses anyone who is not a Deploy App admin.
const BASE = "/ui/mumble/api/v1/admin";
const JSON_BODY = { "Content-Type": "application/json" };

// open: everyone; invite: its members and those of the invite-only nets above it; inherit: as the nearest net
// above that sets its own
export type Access = "open" | "invite" | "inherit";

export interface Channel {
  id: number;
  name: string;
  description: string;
  access: Access;
  members: string[];
  children: Channel[];
}

// A channel plan admins may apply; applying adds the nets that are missing
export interface Template {
  id: string;
  name: string;
  description: string;
  nets: number;
}

export interface ChannelEdit {
  name?: string;
  description?: string;
  access?: Access;
}

export interface User {
  callsign: string;
  admin: boolean;
  revoked: boolean;
  voice_disabled: boolean;
  // Nets the callsign is connected to now; null when murmur-agent has not reported lately
  online: string[] | null;
}

// A TAK mission's net; subscribers are managed in TAK, not here. Guard, the emergency net, is open to
// everyone and has none.
export interface Mission {
  name: string;
  members: string[];
  open: boolean;
}

// FastAPI's {"detail": "..."} reads better as just the sentence, and a validation error's list as its
// messages; null when the body has neither
export function detail(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || !("detail" in parsed)) {
      return null;
    }
    const { detail: found } = parsed;
    if (typeof found === "string") return found;
    if (Array.isArray(found)) {
      const messages = found
        .map((item: unknown) =>
          item && typeof item === "object" && "msg" in item
            ? String(item.msg)
            : "",
        )
        .filter(Boolean);
      return messages.length ? messages.join("; ") : null;
    }
  } catch {
    // not JSON
  }
  return null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(detail(body) ?? `${response.status} ${body}`.trim());
  }
  const type = response.headers.get("content-type") ?? "";
  return (
    type.includes("json") ? response.json() : response.text()
  ) as Promise<T>;
}

const member = (channel: number, callsign: string) =>
  `/channels/${channel}/members/${encodeURIComponent(callsign)}`;

export const api = {
  channels: () => call<Channel[]>("/channels"),
  users: () => call<User[]>("/users"),
  missions: () => call<Mission[]>("/missions"),
  addChannel: (name: string, parent: number) =>
    call<{ id: number }>("/channels", {
      method: "POST",
      headers: JSON_BODY,
      body: JSON.stringify({ name, parent }),
    }),
  removeChannel: (id: number) =>
    call<null>(`/channels/${id}`, { method: "DELETE" }),
  editChannel: (id: number, edit: ChannelEdit) =>
    call<null>(`/channels/${id}`, {
      method: "PATCH",
      headers: JSON_BODY,
      body: JSON.stringify(edit),
    }),
  clearChannels: () =>
    call<{ removed: number }>("/channels", { method: "DELETE" }),
  templates: () => call<Template[]>("/templates"),
  applyTemplate: (template: string) =>
    call<{ created: number }>("/templates/apply", {
      method: "POST",
      headers: JSON_BODY,
      body: JSON.stringify({ template }),
    }),
  addMember: (channel: number, callsign: string) =>
    call<null>(member(channel, callsign), { method: "PUT" }),
  removeMember: (channel: number, callsign: string) =>
    call<null>(member(channel, callsign), { method: "DELETE" }),
  setVoice: (callsign: string, enabled: boolean) =>
    call<null>(`/users/${encodeURIComponent(callsign)}/voice`, {
      method: "PUT",
      headers: JSON_BODY,
      body: JSON.stringify({ enabled }),
    }),
  exportPlan: () => call<string>("/channels/export"),
  importPlan: (yaml: string) =>
    call<{ created: number }>("/channels/import", {
      method: "POST",
      headers: { "Content-Type": "application/yaml" },
      body: yaml,
    }),
};
