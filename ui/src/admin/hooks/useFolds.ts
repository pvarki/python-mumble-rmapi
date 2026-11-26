import { useRef, useState } from "react";

import { read, write } from "../../lib/storage";
import type { Derived } from "../tree";

const FOLDS_KEY = "mumble.folds";
// Larger plans start collapsed to the top level
const EXPAND_UP_TO = 30;

// The fold choices by channel id; anything malformed is ignored
function readFolds(): Map<number, boolean> {
  try {
    const raw: unknown = JSON.parse(read(FOLDS_KEY) ?? "{}");
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.values(raw).every((v) => typeof v === "boolean")
    ) {
      return new Map(
        Object.entries(raw as Record<string, boolean>).map(([id, open]) => [
          Number(id),
          open,
        ]),
      );
    }
  } catch {
    // not JSON
  }
  return new Map();
}

function saveFolds(folds: Map<number, boolean>) {
  write(FOLDS_KEY, JSON.stringify(Object.fromEntries(folds)));
}

// The admin's folds, kept in this browser, over a default by the plan's size; a search unfolds every card
export function useFolds(derived: Derived | null, searching: boolean) {
  const [folds, setFolds] = useState(readFolds);
  // The folds as last written, so a fold made while a sub-net add was in flight is not undone by it
  const written = useRef(folds);
  const expandAll = (derived?.unitCount ?? 0) <= EXPAND_UP_TO;

  const isExpanded = (id: number) => searching || (folds.get(id) ?? expandAll);

  const setExpanded = (id: number, expanded: boolean) => {
    // Ids that left the tree are pruned on every write
    const next = new Map(
      [...written.current].filter(([known]) => derived?.byId.has(known)),
    ).set(id, expanded);
    written.current = next;
    setFolds(next);
    saveFolds(next);
  };

  return { isExpanded, setExpanded };
}
