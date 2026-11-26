// The push-to-talk binding
import { describe, expect, it } from "vitest";

import {
  DEFAULT_BINDING,
  bindingLabel,
  isButton,
  isKey,
  loadBinding,
  parseBinding,
  saveBinding,
  talksOn,
  type Binding,
} from "../src/voice/ptt";
import { blockStorage } from "./storage";

describe("binding", () => {
  it("defaults to Tab and survives a round trip", () => {
    expect(loadBinding()).toEqual({ kind: "key", code: "Tab" });
    expect(DEFAULT_BINDING).toEqual({ kind: "key", code: "Tab" });
    saveBinding({ kind: "key", code: "F12" });
    expect(loadBinding()).toEqual({ kind: "key", code: "F12" });
    saveBinding({ kind: "mouse", button: 3 });
    expect(loadBinding()).toEqual({ kind: "mouse", button: 3 });
  });
  it("falls back on anything it cannot use", () => {
    for (const raw of [
      null,
      "",
      "{",
      "5",
      "null",
      '{"kind":"key"}',
      '{"kind":"key","code":""}',
      '{"kind":"key","code":"Escape"}',
      '{"kind":"mouse","button":0}',
      '{"kind":"mouse","button":"3"}',
      '{"kind":"pedal"}',
    ]) {
      expect(parseBinding(raw), String(raw)).toEqual(DEFAULT_BINDING);
    }
  });
  it("works where storage is blocked", () => {
    blockStorage();
    expect(loadBinding()).toEqual(DEFAULT_BINDING);
    expect(() => saveBinding({ kind: "key", code: "KeyT" })).not.toThrow();
  });
  it("labels keys and buttons", () => {
    expect(bindingLabel({ kind: "key", code: "KeyT" })).toBe("T");
    expect(bindingLabel({ kind: "key", code: "Digit5" })).toBe("5");
    expect(bindingLabel({ kind: "key", code: "F12" })).toBe("F12");
    expect(bindingLabel({ kind: "mouse", button: 3 })).toBe("Mouse 4");
  });
  it("matches only its own key or button", () => {
    const key: Binding = { kind: "key", code: "Space" };
    const mouse: Binding = { kind: "mouse", button: 4 };
    expect(
      isKey(key, "Space") && !isKey(key, "Enter") && !isKey(mouse, "Space"),
    ).toBe(true);
    expect(isButton(mouse, 4) && !isButton(mouse, 3) && !isButton(key, 4)).toBe(
      true,
    );
  });
});

describe("talksOn", () => {
  const press = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
    code,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });
  const tab: Binding = { kind: "key", code: "Tab" };
  it("talks on the bound key alone", () => {
    expect(talksOn(tab, press("Tab"))).toBe(true);
    expect(talksOn(tab, press("Space"))).toBe(false);
    expect(talksOn({ kind: "mouse", button: 3 }, press("Tab"))).toBe(false);
  });
  it("leaves Shift+Tab and shortcuts to the page", () => {
    for (const mod of ["shiftKey", "ctrlKey", "altKey", "metaKey"]) {
      expect(talksOn(tab, press("Tab", { [mod]: true })), mod).toBe(false);
    }
  });
  it("still talks when the bound key is itself a modifier", () => {
    const ctrl: Binding = { kind: "key", code: "ControlRight" };
    expect(talksOn(ctrl, press("ControlRight", { ctrlKey: true }))).toBe(true);
    expect(
      talksOn(
        { kind: "key", code: "ShiftLeft" },
        press("ShiftLeft", { shiftKey: true }),
      ),
    ).toBe(true);
  });
});
