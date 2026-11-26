import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/button";
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
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={ui.MUTED_BTN}
            onClick={choose}
          >
            {t("talk.changeKey")}
          </Button>
        </>
      )}
    </div>
  );
}
