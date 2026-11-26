import { Flag } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { NS } from "../i18n";
import { cn } from "../lib/utils";
import { pathLabel } from "../paths";
import * as ui from "../ui";
import { Frame } from "./Frame";
import { InNet } from "./InNet";
import type { MissionNode } from "./tree";
import type { TreeCtx } from "./types";

// Read-only: subscribers are managed in ATAK Data Sync
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
      <div className={cn(ui.DETAIL_BODY, ctx.wide && ui.DETAIL_SPLIT)}>
        <p className={ui.ACCESS_LINE}>
          {!node.mission.open && <Flag className={ui.ACCESS_ICON} />}
          {t(node.mission.open ? "admin.missionOpen" : "admin.accessMission")}
        </p>
        <div className={ui.CHIPS_ROW}>
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
                  <span className={ui.SR}>{t("admin.isOnline")}</span>
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
