import { useRef } from "react";

// A row control asked to take focus once it is rendered: the row itself, or the chevron of the folded card
// that hides it. center scrolls it to mid-screen first (back from a phone's net screen).
export interface FocusTarget {
  key: string;
  part: "row" | "fold";
  center: boolean;
}

// Focus asked for before its control renders, taken once by the control it names
export function useFocusRequests() {
  const row = useRef<FocusTarget | null>(null);
  const title = useRef<string | null>(null);
  return {
    askRow: (target: FocusTarget | null) => {
      row.current = target;
    },
    askTitle: (key: string) => {
      title.current = key;
    },
    takeFocus: (key: string, part: FocusTarget["part"]) => {
      const target = row.current;
      if (target?.key !== key || target.part !== part) return null;
      row.current = null;
      return target;
    },
    takeTitleFocus: (key: string) => {
      if (title.current !== key) return false;
      title.current = null;
      return true;
    },
  };
}

// Focuses a row control once it was asked for; centred first when coming back from a phone's net screen
export function takeAsked(
  element: HTMLElement | null,
  ask: (part: FocusTarget["part"]) => FocusTarget | null,
  part: FocusTarget["part"],
) {
  const target = element && ask(part);
  if (!element || !target) return;
  if (target.center) element.scrollIntoView({ block: "center" });
  element.focus({ preventScroll: target.center });
}
