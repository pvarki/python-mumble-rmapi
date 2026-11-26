import type { Access, Channel, Mission, User } from "@/api";
import type { FocusTarget } from "./hooks/useFocusRequests";
import type { Derived } from "./tree";

export type Tab = "nets" | "users";

// The panel open above the net list
export type Top = "net" | "templates" | "clear" | null;

export interface Data {
  channels: Channel[];
  users: User[];
  missions: Mission[];
}

// What the open net shows; { last } and { access } ask before removing its last member or narrowing access
export type Mode =
  | "view"
  | "picker"
  | "subnet"
  | "remove"
  | "edit"
  | { last: string }
  | { access: Access };

// Where focus goes when the open net's picker, form or confirmation closes
export type ReturnTo =
  | "member"
  | "subnet"
  | "remove"
  | "edit"
  | { choice: Access }
  | { chip: string };

// key is 'u:<channel id>' for a unit net or 'm:<mission name>' for a mission
export interface Open {
  key: string;
  mode: Mode;
}

// Runs one admin request under a pending key; resolves true on success
export type Run = <T>(
  key: string,
  call: () => Promise<T>,
  onOk?: (result: T) => void,
) => Promise<boolean>;

export interface TreeCtx {
  derived: Derived;
  users: User[];
  open: Open | null;
  // The details show beside the list rather than as the net's own screen
  wide: boolean;
  detailsId: string;
  // On a wide workspace, the open net's own row closes it again
  openNet: (key: string) => void;
  // focusKey is the row that takes focus: the open net's by default, none for null
  closeNet: (focusKey?: string | null) => void;
  setMode: (mode: Mode) => void;
  run: Run;
  pending: Set<string>;
  searching: boolean;
  isExpanded: (id: number) => boolean;
  setExpanded: (id: number, expanded: boolean) => void;
  // The folded card that hides the open net, which marks it on its header
  markedFold: number | null;
  takeFocus: (key: string, part: FocusTarget["part"]) => FocusTarget | null;
  takeTitleFocus: (key: string) => boolean;
}
