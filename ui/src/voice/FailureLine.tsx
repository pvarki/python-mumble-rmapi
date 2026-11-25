import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import * as ui from "../ui";
import type { Failure } from "./client";

export function FailureLine({
  failure,
  detail,
}: {
  failure: Failure;
  detail: string;
}) {
  const { t } = useTranslation(NS);
  return (
    <div role="alert" className={ui.cx(ui.NOTICE, ui.NOTICE_ERR)}>
      <AlertCircle className={ui.cx(ui.NOTICE_ICON, ui.NOTICE_ICON_ERR)} />
      <p className={ui.NOTICE_TEXT}>
        {t(`talk.failure.${failure}`)}
        {detail && <span className={ui.TALK_DETAIL}>{detail}</span>}
      </p>
    </div>
  );
}
