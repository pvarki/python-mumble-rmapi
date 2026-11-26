import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import { NS } from "../i18n";
import * as ui from "../ui";

export function InNet({ callsigns }: { callsigns: string[] }) {
  const { t } = useTranslation(NS);
  if (!callsigns.length) return null;
  return (
    <p className={ui.INNET}>
      <StatusDot state="on" />
      {t("admin.inNetNow")}
      <span className={ui.INNET_WHO}>{callsigns.join(", ")}</span>
    </p>
  );
}
