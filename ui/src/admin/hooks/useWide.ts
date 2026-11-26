import { useEffect, useState, type RefObject } from "react";

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
