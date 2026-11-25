import { Plus, X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "../i18n";
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
          <span
            key={callsign}
            className={ui.cx(ui.CHIP_X, gone && ui.CHIP_DIM)}
            title={gone ? t("admin.revoked") : where?.map(pathLabel).join(", ")}
          >
            {where && (
              <>
                <span className={ui.DOT_ON} />
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
          </span>
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
