import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { NS } from "@/i18n";
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
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{t("talk.key")}</span>
      {choosing ? (
        <span aria-live="polite">{t("talk.pressKey")}</span>
      ) : (
        <>
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
            {label}
          </span>
          <Button type="button" variant="muted" size="xs" onClick={choose}>
            {t("talk.changeKey")}
          </Button>
        </>
      )}
    </div>
  );
}
