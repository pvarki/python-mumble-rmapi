import { useCallback, useRef, useState } from "react";

import type { Run } from "../types";

// Runs the admin's requests (see Run); a success clears an error notice and fetches the data again
export function useRun(
  load: () => Promise<void>,
  fail: (error: unknown) => void,
  clearError: () => void,
) {
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  // Busy controls stay focusable, so a second press must be refused here rather than by the browser
  const inFlight = useRef(new Set<string>());

  const run: Run = useCallback(
    async (key, call, onOk) => {
      if (inFlight.current.has(key)) return false;
      inFlight.current.add(key);
      setPending((keys) => new Set(keys).add(key));
      try {
        const result = await call();
        clearError();
        onOk?.(result);
        await load();
        return true;
      } catch (error) {
        fail(error);
        return false;
      } finally {
        inFlight.current.delete(key);
        setPending((keys) => {
          const next = new Set(keys);
          next.delete(key);
          return next;
        });
      }
    },
    [load, fail, clearError],
  );

  return { run, pending };
}
