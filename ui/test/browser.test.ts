// The id this browser keeps for its voice slot
import { describe, expect, it, vi } from "vitest";

import { loadBrowser } from "../src/voice/browser";
import { blockStorage } from "./storage";

describe("browser", () => {
  const id = "0b7e3c1a-5d2f-4e8b-9a6c-1f2e3d4c5b6a";
  const fresh = () => vi.spyOn(crypto, "randomUUID").mockReturnValue(id);

  it("keeps a valid stored id", () => {
    const uuid = fresh();
    localStorage.setItem("mumble.browser", "laptop-browser-01");
    expect(loadBrowser()).toBe("laptop-browser-01");
    expect(uuid).not.toHaveBeenCalled();
  });
  it("replaces a missing or malformed id and stores the new one", () => {
    fresh();
    for (const bad of [
      null,
      "",
      "a".repeat(15),
      "a".repeat(65),
      "laptop_browser_01",
      "laptop-browser-01\n",
    ]) {
      localStorage.clear();
      if (bad !== null) localStorage.setItem("mumble.browser", bad);
      expect(loadBrowser(), String(bad)).toBe(id);
      expect(localStorage.getItem("mumble.browser")).toBe(id);
    }
  });
  it("gives a fresh id where storage is blocked", () => {
    fresh();
    blockStorage();
    expect(loadBrowser()).toBe(id);
  });
});
