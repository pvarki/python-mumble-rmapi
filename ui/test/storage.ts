import { vi } from "vitest";

// Site data blocked or full: every read and write throws, as in some private windows
export function blockStorage() {
  const blocked = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
}
