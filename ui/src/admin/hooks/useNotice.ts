import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "../../i18n";
import type { Notice } from "../NoticeLine";

const NOTICE_MS = 6_000;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The one notice line: a success clears itself after a while, an error stays until it is dismissed or a later
// request succeeds
export function useNotice() {
  const { t } = useTranslation(NS);
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number>();

  const showNotice = useCallback((next: Notice | null) => {
    window.clearTimeout(timer.current);
    setNotice(next);
    if (next?.kind === "ok") {
      timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
    }
  }, []);

  const fail = useCallback(
    (error: unknown) =>
      showNotice({
        kind: "error",
        text: t("admin.error", { message: messageOf(error), ...RAW }),
      }),
    [t, showNotice],
  );

  const clearError = useCallback(
    () => setNotice((current) => (current?.kind === "error" ? null : current)),
    [],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { notice, showNotice, fail, clearError };
}
