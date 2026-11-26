import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import * as ui from "../ui";

// Replaces window.confirm; the safe choice, Peruuta, has focus. extra sits on the left, before the choice.
// While the request runs, cancelling would only look like it worked, so it waits.
export function InlineConfirm({
  text,
  busy,
  onCancel,
  onConfirm,
  confirmLabel,
  extra,
}: {
  text: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  extra?: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const id = useId();
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <div
      role="alertdialog"
      aria-labelledby={id}
      className={ui.CONFIRM}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <p id={id} className={ui.CONFIRM_TEXT}>
        {text}
      </p>
      {extra}
      <div className={ui.CONFIRM_BTNS}>
        <button
          type="button"
          autoFocus
          className={ui.cx(ui.BTN_SM, ui.SM_GHOST)}
          aria-disabled={busy || undefined}
          onClick={cancel}
        >
          {t("admin.cancel")}
        </button>
        <button
          type="button"
          className={ui.cx(ui.BTN_SM, ui.SM_DANGER)}
          aria-disabled={busy || undefined}
          onClick={onConfirm}
        >
          {confirmLabel ?? t("admin.remove")}
        </button>
      </div>
    </div>
  );
}
