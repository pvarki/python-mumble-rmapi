import { useEffect } from "react";

import type { VoiceClient } from "./client";
import { MOUSE_BUTTONS, isButton, isKey, talksOn } from "./ptt";
import type { Binding } from "./ptt";

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

// The bound key or mouse button talks while held; while choosing a new one, the next press becomes it.
export function usePushToTalk(
  client: VoiceClient,
  binding: Binding,
  choosing: boolean,
  chosen: (binding: Binding | null) => void,
) {
  useEffect(() => {
    const connected = () => client.getSnapshot().phase === "connected";
    const keyDown = (e: KeyboardEvent) => {
      if (choosing) {
        e.preventDefault();
        chosen(
          e.code && e.code !== "Escape" ? { kind: "key", code: e.code } : null,
        );
        return;
      }
      if (!connected() || !talksOn(binding, e) || typingIn(e.target)) return;
      e.preventDefault(); // Tab would move focus, Space would scroll or press a button
      if (!e.repeat) client.talk(true);
    };
    const keyUp = (e: KeyboardEvent) => {
      if (!isKey(binding, e.code) || !connected()) return;
      e.preventDefault();
      client.talk(false);
    };
    const mouseDown = (e: MouseEvent) => {
      if (choosing && MOUSE_BUTTONS.includes(e.button)) {
        e.preventDefault();
        chosen({ kind: "mouse", button: e.button });
        return;
      }
      if (!connected() || !isButton(binding, e.button)) return;
      e.preventDefault();
      client.talk(true);
    };
    // The side buttons would also go back and forward in history
    const mouseUp = (e: MouseEvent) => {
      if (!isButton(binding, e.button)) return;
      e.preventDefault();
      client.talk(false);
    };
    const letGo = () => client.talk(false);
    const hidden = () => {
      if (document.hidden) client.talk(false);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("mousedown", mouseDown);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("blur", letGo);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("mousedown", mouseDown);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("blur", letGo);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [client, binding, choosing, chosen]);
}
