// Voice in the browser: join a net and talk with push-to-talk, on a laptop or a phone (VOICE-PLAN §4.10).
// Push-to-talk is the big button or a key or mouse button the user picks; it works only while this tab has
// focus, and losing focus lets go.
import { Loader2, Mic } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import * as ui from "../ui";
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
  // This browser's id, read on the first click (not while rendering) and kept for the page even where storage
  // throws, so every join from this page logs in the same slot
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
    <section className={ui.TALK} aria-labelledby="mumble-talk">
      <h2 id="mumble-talk" className={ui.TALK_TITLE}>
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
          <p className={ui.MUTED_XS}>{t("talk.intro")}</p>
          {s.failure && <FailureLine failure={s.failure} detail={s.detail} />}
          <button
            type="button"
            aria-disabled={s.phase === "connecting"}
            className={ui.cx(ui.BTN, ui.BTN_PRIMARY_V)}
            onClick={connect}
          >
            {s.phase === "connecting" ? (
              <Loader2 className={ui.LOADER} />
            ) : (
              <Mic className={ui.ICON} />
            )}
            {s.phase === "connecting"
              ? t("talk.connecting")
              : t("talk.connect")}
          </button>
        </>
      )}
    </section>
  );
}
