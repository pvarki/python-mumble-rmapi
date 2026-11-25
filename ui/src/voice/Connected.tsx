import { AlertCircle, Mic } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "../i18n";
import * as ui from "../ui";
import type { Snapshot, VoiceClient } from "./client";
import { KeyLine } from "./KeyLine";
import { callsignOf, isBrowser, netPath, netRows } from "./nets";
import type { Binding } from "./ptt";

// Held down with a thumb or a whole hand: no selection, callout or scrolling may start from it
const PTT_STYLE: CSSProperties = {
  height: "6rem",
  touchAction: "none",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTouchCallout: "none",
};

export function Connected({
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
