import type { Access, User } from "../api";
import type { Derived } from "../paths";

// What the one open net shows; { last } is the guard before removing the last member, { access } the one
// before an access change that moves connected people out
export type Mode =
  | "view"
  | "picker"
  | "subnet"
  | "remove"
  | "edit"
  | { last: string }
  | { access: Access };

// key is 'u:<channel id>' for a unit net or 'm:<mission name>' for a mission
export interface Open {
  key: string;
  mode: Mode;
}

// A row control asked to take focus once it is rendered: the row itself, or the chevron of the folded card
// that hides it. center scrolls it to mid-screen first (back from a phone's net screen).
export interface FocusTarget {
  key: string;
  part: "row" | "fold";
  center: boolean;
}

// Runs one admin request. Only the control whose key is pending is disabled; resolves true on success.
export type Run = <T>(
  key: string,
  call: () => Promise<T>,
  onOk?: (result: T) => void,
) => Promise<boolean>;

export interface TreeCtx {
  derived: Derived;
  users: User[];
  open: Open | null;
  // True when the details show beside the list; false when they replace it as the net's own screen
  wide: boolean;
  // The id of the details section, for aria-controls on the selected row
  detailsId: string;
  // Opens a net (closing it again when it is the selected row on a wide workspace)
  openNet: (key: string) => void;
  // Closes the open net and focuses focusKey's row (the open net's by default; null for none)
  closeNet: (focusKey?: string | null) => void;
  setMode: (mode: Mode) => void;
  run: Run;
  pending: Set<string>;
  searching: boolean;
  isExpanded: (id: number) => boolean;
  setExpanded: (id: number, expanded: boolean) => void;
  // The header of the folded card that hides the open net, which shows the selection bar for it
  markedFold: number | null;
  // Called by each row control after rendering: the target once for the control that was asked for
  takeFocus: (key: string, part: FocusTarget["part"]) => FocusTarget | null;
  // Called by the details after rendering: true once after the net was opened, so its title takes focus
  takeTitleFocus: (key: string) => boolean;
}
