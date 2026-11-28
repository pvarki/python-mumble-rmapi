import { CircleHelp, EyeOff, Globe } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Meta } from "@/App";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NS } from "@/i18n";
import { FeatureGuide } from "./FeatureGuide";
import {
  detectPlatform,
  GUIDE_FILES,
  guideSteps,
  opensItself,
  PLATFORMS,
  saveFinished,
  type Platform,
} from "./guide";

const ICONS: Record<Platform, ReactNode> = {
  browser: <Globe />,
  android: <img src={GUIDE_FILES + "android.svg"} alt="" className="size-4" />,
};

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
  const [platform, setPlatform] = useState(detectPlatform);
  const steps = guideSteps({ voice, admin, platform });
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
      restartOn={platform}
      onFinish={callsign ? () => saveFinished(callsign, steps) : undefined}
      header={
        // Admins without voice only get the nets they manage, which are the same everywhere
        voice && (
          <Select
            value={platform}
            onValueChange={(value) => setPlatform(value as Platform)}
          >
            <SelectTrigger className="w-full" aria-label={t("guide.platform")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((p) => (
                <SelectItem key={p} value={p}>
                  {ICONS[p]}
                  {t(`guide.platforms.${p}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
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
