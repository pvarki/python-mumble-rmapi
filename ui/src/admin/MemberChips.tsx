import { Plus, X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NS, RAW } from "@/i18n";
import { cn } from "@/lib/utils";
import { pathLabel } from "@/paths";
import type { TreeCtx } from "./types";

export function memberKey(id: number, callsign: string): string {
  return `mem:${id}:${callsign}`;
}

export function MemberChips({
  id,
  ctx,
  members,
  picking,
  chips,
  addMember,
  onRemove,
}: {
  id: number;
  ctx: TreeCtx;
  members: string[];
  picking: boolean;
  chips: RefObject<HTMLDivElement>;
  addMember: RefObject<HTMLButtonElement>;
  onRemove: (callsign: string) => void;
}) {
  const { t } = useTranslation(NS);
  const revoked = new Set(
    ctx.users.filter((u) => u.revoked).map((u) => u.callsign),
  );
  return (
    <div ref={chips} className="flex flex-wrap items-center gap-2">
      {members.map((callsign) => {
        const where = ctx.derived.whereOnline.get(callsign);
        const gone = revoked.has(callsign);
        return (
          <Badge
            key={callsign}
            className={cn("min-w-0 px-0 pl-3", gone && "opacity-50")}
            title={gone ? t("admin.revoked") : where?.map(pathLabel).join(", ")}
          >
            {where && (
              <>
                <StatusDot state="on" />
                <span className="sr-only">{t("admin.isOnline")}</span>
              </>
            )}
            <span className="truncate">{callsign}</span>
            <button
              type="button"
              // after:-inset-2 grows the hit area past 40 px; the row's gap-2 keeps it off the next chip
              className="relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-2 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50"
              data-callsign={callsign}
              aria-label={t("admin.removeMember", { callsign, ...RAW })}
              aria-disabled={
                ctx.pending.has(memberKey(id, callsign)) || undefined
              }
              onClick={() => onRemove(callsign)}
            >
              <X className="size-3.5 shrink-0" />
            </button>
          </Badge>
        );
      })}
      {!picking && (
        <Button
          ref={addMember}
          type="button"
          variant="muted"
          size="xs"
          className="relative h-8 gap-1 rounded-full border border-dashed border-input px-3 font-normal after:absolute after:-inset-2 hover:bg-muted/50"
          onClick={() => ctx.setMode("picker")}
        >
          <Plus className="size-3.5" />
          {t("admin.addMember")}
        </Button>
      )}
    </div>
  );
}
