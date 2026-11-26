import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { NS } from "@/i18n";
import { Confirm } from "./Confirm";
import type { Derived } from "./tree";

export function ClearPlan({
  derived,
  busy,
  onExport,
  onClear,
  onClose,
}: {
  derived: Derived;
  busy: boolean;
  onExport: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(NS);
  return (
    <Confirm
      title={t("admin.confirmClear", { count: derived.unitCount })}
      detail={[
        derived.roots.some((r) => r.subtreeOnline) && t("admin.movesOut"),
        t("admin.clearExportFirst"),
      ]
        .filter(Boolean)
        .join(" ")}
      busy={busy}
      confirmLabel={t("admin.removeAll")}
      extra={
        <Button type="button" variant="ghost" onClick={onExport}>
          <Download />
          {t("admin.exportFirst")}
        </Button>
      }
      onCancel={onClose}
      onConfirm={onClear}
    />
  );
}
