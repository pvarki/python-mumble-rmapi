import { Flag, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { NS } from "@/i18n";
import { cn } from "@/lib/utils";
import { takeAsked } from "./hooks/useFocusRequests";
import { OnlineCell } from "./OnlineCell";
import type { MissionNode } from "./tree";
import type { TreeCtx } from "./types";

// Read-only: subscribers are managed in ATAK Data Sync. All missions share one card.
export function MissionRow({ node, ctx }: { node: MissionNode; ctx: TreeCtx }) {
  const { t } = useTranslation(NS);
  const main = useRef<HTMLButtonElement>(null);
  const { name } = node.mission;
  const key = `m:${name}`;
  const selected = ctx.wide && ctx.open?.key === key;

  useEffect(() => {
    takeAsked(main.current, (part) => ctx.takeFocus(key, part), "row");
  });

  return (
    <li data-testid={`mission-${name}`}>
      <div
        className={cn(
          "relative flex h-11 items-stretch",
          selected ? "bg-muted" : "hover:bg-muted/50",
        )}
      >
        {selected && (
          <span
            className="pointer-events-none absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-foreground"
            aria-hidden="true"
          />
        )}
        <button
          ref={main}
          type="button"
          // An inset focus border: the card's overflow-hidden would clip a ring
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md border-2 border-transparent py-2 pr-2 text-left text-sm outline-none focus-visible:border-ring"
          data-testid="row"
          aria-current={selected || undefined}
          aria-controls={selected ? ctx.detailsId : undefined}
          onClick={() => ctx.openNet(key)}
        >
          <span className="flex w-8 shrink-0 items-center justify-center">
            <Flag className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
          <span className="min-w-0 truncate font-semibold" title={name}>
            {name}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {node.mission.open && t("admin.missionOpen")}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
            {!node.mission.open && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Users className="size-3.5 shrink-0" />
                <span className="hidden md:inline">
                  {t("admin.rowSubscribers")}
                </span>
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
