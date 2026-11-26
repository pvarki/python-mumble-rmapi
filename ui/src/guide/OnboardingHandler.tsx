import { CircleHelp, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Meta } from "@/App";
import { Button } from "@/components/ui/button";
import { NS } from "@/i18n";
import { FeatureGuide } from "./FeatureGuide";
import { guideSteps, opensItself, saveFinished } from "./guide";

export function OnboardingHandler({
  meta,
  voice,
  admin,
}: {
  meta: Meta;
  voice: boolean;
  admin: boolean;
}) {
  const { t } = useTranslation(NS);
  const { callsign, autoOpenGuides, onDisableGuides } = meta;
  const steps = guideSteps({ voice, admin });
  const [open, setOpen] = useState(() =>
    opensItself(callsign, steps, autoOpenGuides),
  );
  if (!steps.length) return null;

  return (
    <FeatureGuide
      open={open}
      onOpenChange={setOpen}
      title={t("guide.title")}
      steps={steps}
      onFinish={callsign ? () => saveFinished(callsign, steps) : undefined}
      trigger={
        <Button
          type="button"
          variant="muted"
          size="icon-lg"
          aria-label={t("guide.open")}
          title={t("guide.open")}
        >
          <CircleHelp />
        </Button>
      }
      firstStep={
        // rmui's own setting, for every guide; the help button keeps working after it
        autoOpenGuides !== false &&
        onDisableGuides && (
          <Button
            type="button"
            variant="muted"
            size="sm"
            className="w-full justify-start text-xs font-normal"
            onClick={() => {
              onDisableGuides();
              setOpen(false);
            }}
          >
            <EyeOff />
            {t("guide.disableAutoOpen")}
          </Button>
        )
      }
    />
  );
}
