// The push-to-talk binding and this browser's slot, both remembered per browser. No imports, so
// `node --test` can load this file directly.

// A key by its physical position (KeyboardEvent.code), so the layout does not matter, or an extra mouse
// button. Bluetooth PTT buttons that act as keyboards arrive as keys too.
export type Binding =
  { kind: "key"; code: string } | { kind: "mouse"; button: number };

// Tab (sarkain) is the standard push-to-talk key
export const DEFAULT_BINDING: Binding = { kind: "key", code: "Tab" };
// Middle and the two side buttons; the primary and context buttons stay with the page
export const MOUSE_BUTTONS = [1, 3, 4];
const BINDING_KEY = "mumble.ptt";
const SLOT_KEY = "mumble.webSlot";

// Storage can be missing or throw (private windows, blocked site data); the defaults then apply.
type Store = Pick<Storage, "getItem" | "setItem">;

function read(store: Store | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // remembered for this page only
  }
}

export function parseBinding(raw: string | null): Binding {
  if (!raw) return DEFAULT_BINDING;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "kind" in value) {
      if (
        value.kind === "key" &&
        "code" in value &&
        typeof value.code === "string" &&
        value.code !== "" &&
        value.code !== "Escape"
      ) {
        return { kind: "key", code: value.code };
      }
      if (
        value.kind === "mouse" &&
        "button" in value &&
        typeof value.button === "number" &&
        MOUSE_BUTTONS.includes(value.button)
      ) {
        return { kind: "mouse", button: value.button };
      }
    }
  } catch {
    // fall through to the default
  }
  return DEFAULT_BINDING;
}

export const loadBinding = (store: Store | null): Binding =>
  parseBinding(read(store, BINDING_KEY));

export function saveBinding(store: Store | null, binding: Binding): void {
  write(store, BINDING_KEY, JSON.stringify(binding));
}

// "Tab", "A", "1", "F12", "Numpad0", "Mouse 4"; the caller translates named keys such as Tab
export function bindingLabel(binding: Binding): string {
  if (binding.kind === "mouse") return `Mouse ${binding.button + 1}`;
  const { code } = binding;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

export const isKey = (binding: Binding, code: string): boolean =>
  binding.kind === "key" && binding.code === code;

const MODIFIER = /^(Shift|Control|Alt|Meta|OS)/;
type KeyLike = Pick<
  KeyboardEvent,
  "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey"
>;

// A press of the bound key on its own. With a modifier held the press stays the page's: Shift+Tab still moves
// focus while Tab talks, and Ctrl, Alt and Cmd shortcuts keep working. A modifier bound as the key still talks.
export const talksOn = (binding: Binding, e: KeyLike): boolean =>
  isKey(binding, e.code) &&
  (MODIFIER.test(e.code) ||
    !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey));

export const isButton = (binding: Binding, button: number): boolean =>
  binding.kind === "mouse" && binding.button === button;

// Which of web-1 to web-9 this browser uses. Each browser keeps its own, so a laptop and a phone can be in
// voice at once; a second tab in the same browser takes over from the first.
export function loadSlot(store: Store | null, random: () => number): number {
  const slot = Number(read(store, SLOT_KEY));
  if (Number.isInteger(slot) && slot >= 1 && slot <= 9) return slot;
  const fresh = 1 + Math.floor(random() * 9);
  write(store, SLOT_KEY, String(fresh));
  return fresh;
}
