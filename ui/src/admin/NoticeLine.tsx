import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import { AlertCircle, CheckCircle, X } from "../icons";
import * as ui from "../ui";

export interface Notice {
  kind: "error" | "ok";
  text: string;
}

export function NoticeLine({
  notice,
  dismiss,
}: {
  notice: Notice;
  dismiss: () => void;
}) {
  const { t } = useTranslation(NS);
  const error = notice.kind === "error";
  const Icon = error ? AlertCircle : CheckCircle;
  return (
    <div
      role={error ? "alert" : "status"}
      className={ui.cx(ui.NOTICE, error ? ui.NOTICE_ERR : ui.NOTICE_OK)}
    >
      <Icon className={ui.cx(ui.NOTICE_ICON, error && ui.NOTICE_ICON_ERR)} />
      <p className={ui.NOTICE_TEXT}>{notice.text}</p>
      <button
        type="button"
        className={ui.NOTICE_X}
        aria-label={t("admin.dismiss")}
        onClick={dismiss}
      >
        <X className={ui.ICON} />
      </button>
    </div>
  );
}
