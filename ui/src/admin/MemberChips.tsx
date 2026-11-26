import { Plus, X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/ui/badge";
import { NS, RAW } from "../i18n";
import { cn } from "../lib/utils";
import { pathLabel } from "../paths";
import * as ui from "../ui";
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
    <div ref={chips} className={ui.CHIPS_ROW}>
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
                <span className={ui.SR}>{t("admin.isOnline")}</span>
              </>
            )}
            <span className={ui.CHIP_TEXT}>{callsign}</span>
            <button
              type="button"
              className={ui.CHIP_X_BTN}
              data-callsign={callsign}
              aria-label={t("admin.removeMember", { callsign, ...RAW })}
              aria-disabled={
                ctx.pending.has(memberKey(id, callsign)) || undefined
              }
              onClick={() => onRemove(callsign)}
            >
              <X className={ui.ICON_META} />
            </button>
          </Badge>
        );
      })}
      {!picking && (
        <button
          ref={addMember}
          type="button"
          className={ui.CHIP_ADD}
          onClick={() => ctx.setMode("picker")}
        >
          <Plus className={ui.ICON_META} />
          {t("admin.addMember")}
        </button>
      )}
    </div>
  );
}
