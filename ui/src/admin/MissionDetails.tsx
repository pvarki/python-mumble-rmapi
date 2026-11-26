import { Flag } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { NS } from "@/i18n";
import { cn } from "@/lib/utils";
import { pathLabel } from "@/paths";
import { Frame } from "./Frame";
import { InNet } from "./InNet";
import type { MissionNode } from "./tree";
import type { TreeCtx } from "./types";

export function MissionDetails({
  node,
  ctx,
  notice,
}: {
  node: MissionNode;
  ctx: TreeCtx;
  notice: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const { name } = node.mission;
  return (
    <Frame
      ctx={ctx}
      netKey={`m:${name}`}
      path={t("admin.missions")}
      name={name}
      testId="mission-panel"
    >
      {notice}
      <div
        className={cn("space-y-3", ctx.wide && "border-t border-border pt-3")}
      >
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          {!node.mission.open && <Flag className="mt-0.5 size-3.5 shrink-0" />}
          {t(node.mission.open ? "admin.missionOpen" : "admin.accessMission")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {node.subscribers.map((s) => (
            <Badge
              key={s.callsign}
              className={cn(!s.known && "opacity-50")}
              title={
                s.known
                  ? ctx.derived.whereOnline
                      .get(s.callsign)
                      ?.map(pathLabel)
                      .join(", ")
                  : t("admin.notUser")
              }
            >
              {s.online && (
                <>
                  <StatusDot state="on" />
                  <span className="sr-only">{t("admin.isOnline")}</span>
                </>
              )}
              {s.callsign}
            </Badge>
          ))}
        </div>
        <InNet callsigns={node.online} />
      </div>
    </Frame>
  );
}
