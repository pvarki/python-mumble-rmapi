import { AlertCircle, Mic } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { NS, RAW } from "../i18n";
import { cn } from "../lib/utils";
import * as ui from "../ui";
import type { Snapshot, VoiceClient } from "./client";
import { KeyLine } from "./KeyLine";
import { callsignOf, isBrowser, netGroups, netPath, netRows } from "./nets";
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
  const groups = netGroups(netRows(s.nets, s.people));
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
          <StatusDot state="on" />
          {t("talk.connectedAs", {
            name: me ? callsignOf(me.name) : "",
            ...RAW,
          })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => client.disconnect()}
        >
          {t("talk.leave")}
        </Button>
      </div>

      <Select
        value={me && here ? String(me.channel) : ""}
        onValueChange={(id) => client.join(Number(id))}
      >
        <SelectTrigger className={ui.NET_PICK} aria-label={t("talk.net")}>
          <SelectValue placeholder={t("talk.pickNet")}>{hereLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent style={ui.NET_LIST_STYLE}>
          {groups.map((group) => (
            <SelectGroup key={group.id}>
              <SelectLabel>
                {t(`talk.group.${group.name}`, { defaultValue: group.name })}
              </SelectLabel>
              {group.rows.map((row) => (
                <SelectItem
                  key={row.id}
                  value={String(row.id)}
                  disabled={!row.joinable}
                  textValue={row.name}
                  className={ui.NET_OPTION}
                >
                  {Array.from({ length: row.depth - 1 }, (_, i) => (
                    <span key={i} className={ui.INDENT} />
                  ))}
                  <span className={ui.NAME_SUB}>{row.name}</span>
                  {row.count > 0 && (
                    <span className={ui.MUTED_XS}>
                      {t("talk.people", { count: row.count })}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {me?.suppress && <p className={ui.MUTED_XS}>{t("talk.listenOnly")}</p>}
      {s.denied !== null && (
        <Alert variant="destructive">
          <AlertCircle />
          {/* A block, not a grid, so that a long word wraps */}
          <AlertDescription className="block min-w-0 break-words text-foreground">
            {s.denied || t("talk.denied")}
          </AlertDescription>
        </Alert>
      )}

      {around.length > 0 && (
        <div className={ui.CHIPS_ROW} aria-label={t("talk.inThisNet")}>
          {around.map((p) => (
            <Badge key={p.session}>
              <StatusDot
                state={
                  s.talking.has(p.session) ||
                  (p.session === s.self && s.transmitting)
                    ? "on"
                    : "off"
                }
              />
              {callsignOf(p.name)}
              {isBrowser(p.name) && (
                <span className={ui.MUTED_XS}>{t("talk.web")}</span>
              )}
            </Badge>
          ))}
        </div>
      )}

      <div className={ui.TALK_PTT_BAR}>
        <p className={ui.TALK_SPEAKING} aria-live="polite">
          {speaking.length > 0 && (
            <>
              <StatusDot state="on" />
              {t("talk.speaking", { names: speaking.join(", "), ...RAW })}
            </>
          )}
        </p>
        <button
          type="button"
          aria-pressed={s.transmitting}
          disabled={!here}
          className={cn(
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
