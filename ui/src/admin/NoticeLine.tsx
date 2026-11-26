import { AlertCircle, CheckCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "../components/ui/alert";
import { NS } from "../i18n";
import { cn } from "../lib/utils";
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
  // Only the icon takes the error's red, as in the other error lines
  const tone = error ? "text-foreground" : "text-current";
  return (
    // A row, not the Alert's grid, so the dismiss button fits beside the words; they are a block so a long
    // word wraps
    <Alert
      variant={error ? "destructive" : "default"}
      role={error ? "alert" : "status"}
      className={cn("flex", !error && ui.NOTICE_OK)}
    >
      <Icon />
      <AlertDescription
        className={cn("block min-w-0 flex-1 break-words", tone)}
      >
        {notice.text}
      </AlertDescription>
      <button
        type="button"
        className={cn(ui.NOTICE_X, tone)}
        aria-label={t("admin.dismiss")}
        onClick={dismiss}
      >
        <X className={ui.ICON} />
      </button>
    </Alert>
  );
}
