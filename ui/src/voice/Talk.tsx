// Voice in the browser: join a net and talk with push-to-talk, on a laptop or a phone (VOICE-PLAN §4.10).
// Push-to-talk is the big button or a key or mouse button the user picks; it works only while this tab has
// focus, and losing focus lets go.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { AlertCircle, Loader, Mic } from "../icons";
import { NS, RAW } from "../i18n";
import * as ui from "../ui";
import { VoiceClient } from "./client";
import type { Failure, Snapshot } from "./client";
import { callsignOf, isBrowser, netPath, netRows } from "./nets";
import {
  MOUSE_BUTTONS,
  bindingLabel,
  isButton,
  isKey,
  loadBinding,
  loadSlot,
  saveBinding,
  talksOn,
} from "./ptt";
import type { Binding } from "./ptt";

// Held down with a thumb or a whole hand: no selection, callout or scrolling may start from it
const PTT_STYLE: CSSProperties = {
  height: "6rem",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

// The bound key or mouse button talks while held; while choosing a new one, the next press becomes it.
function usePushToTalk(
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

function FailureLine({
  failure,
  detail,
}: {
  failure: Failure;
  detail: string;
}) {
  const { t } = useTranslation(NS);
  return (
    <div role="alert" className={ui.cx(ui.NOTICE, ui.NOTICE_ERR)}>
      <AlertCircle className={ui.cx(ui.NOTICE_ICON, ui.NOTICE_ICON_ERR)} />
      <p className={ui.NOTICE_TEXT}>
        {t(`talk.failure.${failure}`)}
        {detail && <span className={ui.TALK_DETAIL}>{detail}</span>}
      </p>
    </div>
  );
}

function KeyLine({
  binding,
  choosing,
  choose,
}: {
  binding: Binding;
  choosing: boolean;
  choose: () => void;
}) {
  const { t } = useTranslation(NS);
  const label =
    binding.kind === "key"
      ? t(`talk.keys.${binding.code}`, { defaultValue: bindingLabel(binding) })
      : bindingLabel(binding);
  return (
    <div className={ui.TALK_KEY}>
      <span>{t("talk.key")}</span>
      {choosing ? (
        <span aria-live="polite">{t("talk.pressKey")}</span>
      ) : (
        <>
          <span className={ui.NET_TAG}>{label}</span>
          <button
            type="button"
            className={ui.cx(ui.LINK_BTN, ui.LINK_MUTED)}
            onClick={choose}
          >
            {t("talk.changeKey")}
          </button>
        </>
      )}
    </div>
  );
}

function Connected({
  client,
  s,
  binding,
  choosing,
  choose,
}: {
  client: VoiceClient;
  s: Snapshot;
  binding: Binding;
  choosing: boolean;
  choose: () => void;
}) {
  const { t } = useTranslation(NS);
  const me = s.self === null ? undefined : s.people.get(s.self);
  const here = me ? netPath(s.nets, me.channel) : "";
  // The group in the user's language: "Yksiköt › General"
  const [group, ...rest] = here.split(" › ");
  const hereLabel = [
    t(`talk.group.${group}`, { defaultValue: group }),
    ...rest,
  ].join(" › ");
  const rows = netRows(s.nets, s.people);
  const around = [...s.people.values()]
    .filter((p) => me && p.channel === me.channel && me.channel !== 0)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Who is heard now, by callsign; named again by the button, where a phone always shows it
  const speaking = around
    .filter((p) => p.session !== s.self && s.talking.has(p.session))
    .map((p) => callsignOf(p.name));
  const press = (on: boolean) => client.talk(on);

  return (
    <>
      <div className={ui.TALK_STATUS}>
        <span className={ui.YOU_STATUS}>
          <span className={ui.DOT_ON} />
          {t("talk.connectedAs", {
            name: me ? callsignOf(me.name) : "",
            ...RAW,
          })}
        </span>
        <button
          type="button"
          className={ui.cx(ui.BTN_SM, ui.SM_GHOST)}
          onClick={() => client.disconnect()}
        >
          {t("talk.leave")}
        </button>
      </div>

      <p className={ui.TALK_HERE}>
        {here ? t("talk.inNet", { net: hereLabel, ...RAW }) : t("talk.pickNet")}
      </p>
      {me?.suppress && <p className={ui.MUTED_XS}>{t("talk.listenOnly")}</p>}
      {s.denied !== null && (
        <div role="alert" className={ui.cx(ui.NOTICE, ui.NOTICE_ERR)}>
          <AlertCircle className={ui.cx(ui.NOTICE_ICON, ui.NOTICE_ICON_ERR)} />
          <p className={ui.NOTICE_TEXT}>{s.denied || t("talk.denied")}</p>
        </div>
      )}

      {around.length > 0 && (
        <div className={ui.CHIPS_ROW} aria-label={t("talk.inThisNet")}>
          {around.map((p) => (
            <span key={p.session} className={ui.CHIP}>
              <span
                className={
                  s.talking.has(p.session) ||
                  (p.session === s.self && s.transmitting)
                    ? ui.DOT_ON
                    : ui.DOT_OFF
                }
              />
              {callsignOf(p.name)}
              {isBrowser(p.name) && (
                <span className={ui.MUTED_XS}>{t("talk.web")}</span>
              )}
            </span>
          ))}
        </div>
      )}

      <nav aria-label={t("talk.nets")} className={ui.CARD}>
        {rows.map((row) =>
          row.depth === 0 ? (
            <h3 key={row.id} className={ui.HEADING}>
              {t(`talk.group.${row.name}`, { defaultValue: row.name })}
            </h3>
          ) : (
            <button
              key={row.id}
              type="button"
              disabled={!row.joinable}
              aria-current={me?.channel === row.id ? "true" : undefined}
              className={ui.cx(
                ui.TALK_ROW,
                me?.channel === row.id ? ui.ROW_ON : ui.ROW_IDLE,
                !row.joinable && ui.ROW_CONTEXT,
              )}
              onClick={() => client.join(row.id)}
            >
              {me?.channel === row.id && <span className={ui.SEL_BAR} />}
              {Array.from({ length: row.depth - 1 }, (_, i) => (
                <span key={i} className={ui.INDENT} />
              ))}
              <span className={ui.NAME_SUB}>{row.name}</span>
              {row.count > 0 && (
                <span className={ui.TALK_COUNT}>
                  {t("talk.people", { count: row.count })}
                </span>
              )}
            </button>
          ),
        )}
      </nav>

      <div className={ui.TALK_PTT_BAR}>
        <p className={ui.TALK_SPEAKING} aria-live="polite">
          {speaking.length > 0 && (
            <>
              <span className={ui.DOT_ON} />
              {t("talk.speaking", { names: speaking.join(", "), ...RAW })}
            </>
          )}
        </p>
        <button
          type="button"
          aria-pressed={s.transmitting}
          disabled={!here}
          className={ui.cx(
            ui.TALK_PTT,
            s.transmitting ? ui.TALK_PTT_ON : ui.TALK_PTT_OFF,
          )}
          style={PTT_STYLE}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            press(true);
          }}
          onPointerUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onLostPointerCapture={() => press(false)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.repeat) press(true);
          }}
          onKeyUp={(e) => {
            if (e.key === "Enter") press(false);
          }}
        >
          <Mic className={ui.TALK_PTT_ICON} />
          {s.transmitting ? t("talk.transmitting") : t("talk.hold")}
        </button>
        <KeyLine binding={binding} choosing={choosing} choose={choose} />
      </div>
    </>
  );
}

export function Talk() {
  const { t } = useTranslation(NS);
  const [client] = useState(() => new VoiceClient());
  const s = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [binding, setBinding] = useState(() => loadBinding(storage()));
  const [choosing, setChoosing] = useState(false);
  const chosen = useCallback((next: Binding | null) => {
    if (next) {
      saveBinding(storage(), next);
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
            onClick={() =>
              void client.connect(loadSlot(storage(), Math.random))
            }
          >
            {s.phase === "connecting" ? (
              <Loader className={ui.LOADER} />
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
