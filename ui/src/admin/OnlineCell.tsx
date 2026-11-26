import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import * as ui from "../ui";

// Always rendered, so the green counts line up in one column. A folded row counts its whole group.
export function OnlineCell({
  count,
  known,
  group = false,
}: {
  count: number;
  known: boolean;
  group?: boolean;
}) {
  const { t } = useTranslation(NS);
  const show = known && count > 0;
  return (
    <span
      className={ui.CELL_ONLINE}
      aria-label={
        show
          ? t(group ? "admin.groupOnline" : "admin.onlineCount", { count })
          : undefined
      }
    >
      {show && (
        <>
          <span className={ui.DOT_ON} />
          {count}
        </>
      )}
    </span>
  );
}
