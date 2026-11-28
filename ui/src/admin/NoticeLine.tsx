import { AlertCircle, CheckCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { NS } from "@/i18n";
import { cn } from "@/lib/utils";

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
      className={cn(
        "flex",
        !error && "border-green-500/20 bg-green-500/10 text-green-600",
      )}
    >
      <Icon />
      <AlertDescription
        className={cn("block min-w-0 flex-1 break-words", tone)}
      >
        {notice.text}
      </AlertDescription>
      <button
        type="button"
        // after:-inset-2 grows the hit area to 40 px
        className={cn(
          "relative inline-flex size-6 shrink-0 items-center justify-center rounded-md outline-none after:absolute after:-inset-2 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          tone,
        )}
        aria-label={t("admin.dismiss")}
        onClick={dismiss}
      >
        <X className="size-4 shrink-0" />
      </button>
    </Alert>
  );
}
