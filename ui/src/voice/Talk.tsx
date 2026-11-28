import { Loader2, Mic } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { NS } from "@/i18n";
import { loadBrowser } from "./browser";
import { VoiceClient } from "./client";
import { Connected } from "./Connected";
import { FailureLine } from "./FailureLine";
import { loadBinding, saveBinding } from "./ptt";
import type { Binding } from "./ptt";
import { usePushToTalk } from "./usePushToTalk";

export function Talk() {
  const { t } = useTranslation(NS);
  const [client] = useState(() => new VoiceClient());
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [binding, setBinding] = useState(loadBinding);
  const [choosing, setChoosing] = useState(false);
  // Read on the first click and kept, so every join from this page logs in the same slot
  const browser = useRef<string | null>(null);
  const connect = () => {
    browser.current ??= loadBrowser();
    void client.connect(browser.current);
  };
  const chosen = useCallback((next: Binding | null) => {
    if (next) {
      saveBinding(next);
      setBinding(next);
    }
    setChoosing(false);
  }, []);

  useEffect(() => () => client.disconnect(), [client]);
  usePushToTalk(client, binding, choosing, chosen);

  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-labelledby="mumble-talk"
    >
      <h2 id="mumble-talk" className="text-base font-semibold">
        {t("talk.title")}
      </h2>
      {s.phase === "connected" ? (
        <Connected
          client={client}
          s={s}
          binding={binding}
          choosing={choosing}
          choose={() => setChoosing(true)}
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("talk.intro")}</p>
          {s.failure && <FailureLine failure={s.failure} detail={s.detail} />}
          <Button
            type="button"
            aria-disabled={s.phase === "connecting"}
            onClick={connect}
          >
            {s.phase === "connecting" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Mic />
            )}
            {s.phase === "connecting"
              ? t("talk.connecting")
              : t("talk.connect")}
          </Button>
        </>
      )}
    </section>
  );
}
