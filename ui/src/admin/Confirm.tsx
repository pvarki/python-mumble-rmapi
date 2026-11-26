import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { NS } from "@/i18n";

// Open while rendered: the caller closes it and moves focus. It cannot be cancelled once the request is sent.
export function Confirm({
  title,
  detail,
  busy,
  onCancel,
  onConfirm,
  confirmLabel,
  extra,
}: {
  title: string;
  detail?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  extra?: ReactNode;
}) {
  const { t } = useTranslation(NS);
  return (
    <AlertDialog
      open
      onOpenChange={() => {
        if (!busy) onCancel();
      }}
    >
      <AlertDialogContent
        // Radix links a description itself; without one, it asks for aria-describedby set to undefined
        {...(!detail && { "aria-describedby": undefined })}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Esc closes the confirmation only, not the net it sits in
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {detail && <AlertDialogDescription>{detail}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {extra}
          <AlertDialogCancel aria-disabled={busy || undefined}>
            {t("admin.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            aria-disabled={busy || undefined}
            onClick={(event) => {
              // Stays open until the request is done
              event.preventDefault();
              onConfirm();
            }}
          >
            {confirmLabel ?? t("admin.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
