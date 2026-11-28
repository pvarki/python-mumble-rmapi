import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

// Whether the workspace (not the viewport: rmui's sidebar takes part of it) is wide enough for the side panel
export function useWide(
  ref: RefObject<HTMLElement | null>,
  min: number,
): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= min),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, min]);
  return wide;
}

// Below rmui's header, and the sticky panel's offset
const SCREEN_TAKEN = 96;

// Whether an element fits in the height that rmui leaves on screen, known before it is painted. Null watches
// nothing and answers true.
export function useFitsScreen(ref: RefObject<HTMLElement | null> | null) {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const element = ref?.current;
    if (!element) return;
    const check = () =>
      setFits(element.offsetHeight <= window.innerHeight - SCREEN_TAKEN);
    const observer = new ResizeObserver(check);
    observer.observe(element);
    window.addEventListener("resize", check);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [ref]);
  return fits;
}
