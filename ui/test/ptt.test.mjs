// Unit tests for the push-to-talk binding and the browser id: `pnpm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BINDING,
  bindingLabel,
  isButton,
  isKey,
  loadBinding,
  loadBrowser,
  parseBinding,
  saveBinding,
  talksOn,
} from "../src/voice/ptt.ts";

function memory() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
  };
}

const broken = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

describe("binding", () => {
  it("defaults to Tab and survives a round trip", () => {
    const store = memory();
    assert.deepEqual(loadBinding(store), { kind: "key", code: "Tab" });
    assert.deepEqual(DEFAULT_BINDING, { kind: "key", code: "Tab" });
    saveBinding(store, { kind: "key", code: "F12" });
    assert.deepEqual(loadBinding(store), { kind: "key", code: "F12" });
    saveBinding(store, { kind: "mouse", button: 3 });
    assert.deepEqual(loadBinding(store), { kind: "mouse", button: 3 });
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
      assert.deepEqual(parseBinding(raw), DEFAULT_BINDING, String(raw));
    }
  });
  it("works without storage", () => {
    assert.deepEqual(loadBinding(broken), DEFAULT_BINDING);
    assert.deepEqual(loadBinding(null), DEFAULT_BINDING);
    saveBinding(broken, { kind: "key", code: "KeyT" });
  });
  it("labels keys and buttons", () => {
    assert.equal(bindingLabel({ kind: "key", code: "KeyT" }), "T");
    assert.equal(bindingLabel({ kind: "key", code: "Digit5" }), "5");
    assert.equal(bindingLabel({ kind: "key", code: "F12" }), "F12");
    assert.equal(bindingLabel({ kind: "mouse", button: 3 }), "Mouse 4");
  });
  it("matches only its own key or button", () => {
    const key = { kind: "key", code: "Space" };
    const mouse = { kind: "mouse", button: 4 };
    assert.ok(
      isKey(key, "Space") && !isKey(key, "Enter") && !isKey(mouse, "Space"),
    );
    assert.ok(isButton(mouse, 4) && !isButton(mouse, 3) && !isButton(key, 4));
  });
});

describe("talksOn", () => {
  const press = (code, mods = {}) => ({
    code,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });
  const tab = { kind: "key", code: "Tab" };
  it("talks on the bound key alone", () => {
    assert.ok(talksOn(tab, press("Tab")));
    assert.ok(!talksOn(tab, press("Space")));
    assert.ok(!talksOn({ kind: "mouse", button: 3 }, press("Tab")));
  });
  it("leaves Shift+Tab and shortcuts to the page", () => {
    for (const mod of ["shiftKey", "ctrlKey", "altKey", "metaKey"]) {
      assert.ok(!talksOn(tab, press("Tab", { [mod]: true })), mod);
    }
  });
  it("still talks when the bound key is itself a modifier", () => {
    const ctrl = { kind: "key", code: "ControlRight" };
    assert.ok(talksOn(ctrl, press("ControlRight", { ctrlKey: true })));
    assert.ok(
      talksOn(
        { kind: "key", code: "ShiftLeft" },
        press("ShiftLeft", { shiftKey: true }),
      ),
    );
  });
});

describe("browser", () => {
  const id = "laptop-browser-01";
  it("keeps a valid stored id", () => {
    const store = memory();
    store.setItem("mumble.browser", id);
    assert.equal(
      loadBrowser(store, () => assert.fail("fresh")),
      id,
    );
  });
  it("replaces a missing or malformed id and stores the new one", () => {
    for (const bad of [
      null,
      "",
      "a".repeat(15),
      "a".repeat(65),
      "laptop_browser_01",
      "laptop-browser-01\n",
    ]) {
      const store = memory();
      if (bad !== null) store.setItem("mumble.browser", bad);
      assert.equal(
        loadBrowser(store, () => id),
        id,
        String(bad),
      );
      assert.equal(store.data.get("mumble.browser"), id);
    }
  });
  it("gives a fresh id without storage", () => {
    assert.equal(
      loadBrowser(broken, () => id),
      id,
    );
    assert.equal(
      loadBrowser(null, () => id),
      id,
    );
  });
});
