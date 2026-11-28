// The push-to-talk binding, remembered per browser
import { read, write } from "@/lib/storage";

// A key by its physical position (KeyboardEvent.code), so the layout does not matter, or an extra mouse
// button. Bluetooth PTT buttons that act as keyboards arrive as keys too.
export type Binding =
  { kind: "key"; code: string } | { kind: "mouse"; button: number };

// Tab (sarkain) is the standard push-to-talk key
export const DEFAULT_BINDING: Binding = { kind: "key", code: "Tab" };
// Middle and the two side buttons; the primary and context buttons stay with the page
export const MOUSE_BUTTONS = [1, 3, 4];
const BINDING_KEY = "mumble.ptt";

export function loadBinding(): Binding {
  const raw = read(BINDING_KEY);
  try {
    return raw ? (JSON.parse(raw) as Binding) : DEFAULT_BINDING;
  } catch {
    return DEFAULT_BINDING;
  }
}

export function saveBinding(binding: Binding): void {
  write(BINDING_KEY, JSON.stringify(binding));
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
