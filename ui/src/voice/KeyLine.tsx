import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import * as ui from "../ui";
import { bindingLabel } from "./ptt";
import type { Binding } from "./ptt";

export function KeyLine({
  binding,
  choosing,
  choose,
}: {
  binding: Binding;
  choosing: boolean;
  choose: () => void;
}) {
  const { t } = useTranslation(NS);
  const label =
    binding.kind === "key"
      ? t(`talk.keys.${binding.code}`, { defaultValue: bindingLabel(binding) })
      : bindingLabel(binding);
  return (
    <div className={ui.TALK_KEY}>
      <span>{t("talk.key")}</span>
      {choosing ? (
        <span aria-live="polite">{t("talk.pressKey")}</span>
      ) : (
        <>
          <span className={ui.NET_TAG}>{label}</span>
          <button
            type="button"
            className={ui.cx(ui.LINK_BTN, ui.LINK_MUTED)}
            onClick={choose}
          >
            {t("talk.changeKey")}
          </button>
        </>
      )}
    </div>
  );
}
