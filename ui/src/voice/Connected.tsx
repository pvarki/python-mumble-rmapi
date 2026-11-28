import { AlertCircle, Mic } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NS, RAW } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Snapshot, VoiceClient } from "./client";
import { KeyLine } from "./KeyLine";
import { callsignOf, isBrowser, netGroups, netPath, netRows } from "./nets";
import type { Binding } from "./ptt";

// Inline, as rmui's CSS has no h-24 and no class for the touch callout
const PTT_STYLE: CSSProperties = { height: "6rem", WebkitTouchCallout: "none" };

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
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5">
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
        <SelectTrigger className="w-full" aria-label={t("talk.net")}>
          <SelectValue placeholder={t("talk.pickNet")}>{hereLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent
          style={{
            maxHeight:
              "min(50vh, var(--radix-select-content-available-height))",
          }}
        >
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
                  className="min-h-11"
                >
                  {Array.from({ length: row.depth - 1 }, (_, i) => (
                    <span key={i} className="w-4 shrink-0" />
                  ))}
                  <span className="min-w-0 truncate font-medium">
                    {row.name}
                  </span>
                  {row.count > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t("talk.people", { count: row.count })}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {me?.suppress && (
        <p className="text-xs text-muted-foreground">{t("talk.listenOnly")}</p>
      )}
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
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label={t("talk.inThisNet")}
        >
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
                <span className="text-xs text-muted-foreground">
                  {t("talk.web")}
                </span>
              )}
            </Badge>
          ))}
        </div>
      )}

      <div className="sticky bottom-0 z-10 space-y-2 bg-card py-2">
        <p
          // min-h-4 keeps the line when nobody talks, so the button under a thumb never moves
          className="flex min-h-4 items-center gap-1.5 text-xs text-green-600"
          aria-live="polite"
        >
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
            "flex w-full touch-none select-none flex-col items-center justify-center gap-1 rounded-xl border-2 border-primary text-base font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50",
            s.transmitting
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary",
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
          <Mic className="size-8" />
          {s.transmitting ? t("talk.transmitting") : t("talk.hold")}
        </button>
        <KeyLine binding={binding} choosing={choosing} choose={choose} />
      </div>
    </>
  );
}
