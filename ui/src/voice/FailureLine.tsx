import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { NS } from "@/i18n";
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
    <Alert variant="destructive">
      <AlertCircle />
      {/* A block, not a grid, so that a long word wraps */}
      <AlertDescription className="block min-w-0 break-words text-foreground">
        {t(`talk.failure.${failure}`)}
        {detail && (
          <span className="block text-xs text-muted-foreground">{detail}</span>
        )}
      </AlertDescription>
    </Alert>
  );
}
