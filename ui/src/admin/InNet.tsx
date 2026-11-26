import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { NS } from "@/i18n";

export function InNet({ callsigns }: { callsigns: string[] }) {
  const { t } = useTranslation(NS);
  if (!callsigns.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-green-600">
      <StatusDot state="on" />
      {t("admin.inNetNow")}
      <span className="font-medium">{callsigns.join(", ")}</span>
    </p>
  );
}
