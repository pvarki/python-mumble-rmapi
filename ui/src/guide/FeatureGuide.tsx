import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { NS } from "../i18n";
import * as ui from "../ui";
import type { GuideStep } from "./guide";

// A few steps in a dialog, like the matrix and TAK remotes' guides, without their pictures
export function FeatureGuide({
  open,
  onOpenChange,
  title,
  steps,
  trigger,
  onFinish,
  firstStep,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  steps: readonly GuideStep[];
  // The button that opens the guide, and takes focus back when it closes
  trigger: ReactNode;
  // Finish on the last step, which then closes the guide
  onFinish?: () => void;
  // Shown under the buttons on the first step only
  firstStep?: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const [index, setIndex] = useState(0);
  const next = useRef<HTMLButtonElement>(null);
  const at = Math.min(index, steps.length - 1);
  const step = steps[at];
  if (!step) return null;
  const last = at === steps.length - 1;

  const change = (isOpen: boolean) => {
    if (!isOpen) setIndex(0);
    onOpenChange(isOpen);
  };
  const forward = () => {
    if (!last) {
      setIndex(at + 1);
      return;
    }
    onFinish?.();
    change(false);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className={ui.GUIDE}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          next.current?.focus();
        }}
      >
        <div className={ui.GUIDE_HEAD}>
          <div className={ui.GUIDE_TITLES}>
            <DialogTitle>{title}</DialogTitle>
            <p className={ui.MUTED_XS}>
              {t("guide.step", { n: at + 1, count: steps.length })}
            </p>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={ui.MUTED_BTN}
              aria-label={t("guide.close")}
              title={t("guide.close")}
            >
              <X />
            </Button>
          </DialogClose>
        </div>
        <h3 className={ui.GUIDE_STEP}>{t(step.title)}</h3>
        <DialogDescription className={ui.GUIDE_TEXT}>
          {t(step.description)}
        </DialogDescription>
        <div className={ui.GUIDE_BAR}>
          <div
            className={ui.GUIDE_FILL}
            style={{ width: `${((at + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className={ui.GUIDE_BTNS}>
          {/* aria-disabled rather than disabled, so focus stays on it after going back to the first step */}
          <Button
            type="button"
            variant="outline"
            className={ui.GUIDE_BTN}
            aria-disabled={at === 0}
            onClick={() => at > 0 && setIndex(at - 1)}
          >
            <ChevronLeft />
            {t("guide.back")}
          </Button>
          <Button
            ref={next}
            type="button"
            className={ui.GUIDE_BTN}
            onClick={forward}
          >
            {last ? t("guide.finish") : t("guide.next")}
            <ChevronRight />
          </Button>
        </div>
        {at === 0 && firstStep}
      </DialogContent>
    </Dialog>
  );
}
