import { Flag, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import { cn } from "../lib/utils";
import * as ui from "../ui";
import { takeAsked } from "./hooks/useFocusRequests";
import { OnlineCell } from "./OnlineCell";
import type { MissionNode } from "./tree";
import type { TreeCtx } from "./types";

// Read-only: subscribers are managed in ATAK Data Sync. All missions share one card.
export function MissionRow({
  node,
  ctx,
  first,
}: {
  node: MissionNode;
  ctx: TreeCtx;
  first: boolean;
}) {
  const { t } = useTranslation(NS);
  const main = useRef<HTMLButtonElement>(null);
  const { name } = node.mission;
  const key = `m:${name}`;
  const selected = ctx.wide && ctx.open?.key === key;

  useEffect(() => {
    takeAsked(main.current, (part) => ctx.takeFocus(key, part), "row");
  });

  return (
    <li className={first ? undefined : ui.SEP} data-testid={`mission-${name}`}>
      <div className={cn(ui.ROW, selected ? ui.ROW_ON : ui.ROW_IDLE)}>
        {selected && <span className={ui.SEL_BAR} aria-hidden="true" />}
        <button
          ref={main}
          type="button"
          className={ui.ROW_MAIN}
          data-testid="row"
          aria-current={selected || undefined}
          aria-controls={selected ? ctx.detailsId : undefined}
          onClick={() => ctx.openNet(key)}
        >
          <span className={ui.LEAD}>
            <Flag className={ui.FLAG} />
          </span>
          <span className={ui.NAME} title={name}>
            {name}
          </span>
          <span className={ui.DESC}>
            {node.mission.open && t("admin.missionOpen")}
          </span>
          <span className={ui.META}>
            {!node.mission.open && (
              <span className={ui.ACC_FOLLOWS}>
                <Users className={ui.ICON_META} />
                <span className={ui.ACC_WORD}>{t("admin.rowSubscribers")}</span>
                {node.subscribers.length}
              </span>
            )}
            <OnlineCell
              count={node.online.length}
              known={ctx.derived.presenceKnown}
            />
          </span>
        </button>
      </div>
    </li>
  );
}
