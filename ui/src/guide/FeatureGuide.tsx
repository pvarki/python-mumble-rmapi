import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NS } from "@/i18n";
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
        className="max-h-[90vh] overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          next.current?.focus();
        }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <DialogTitle>{title}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {t("guide.step", { n: at + 1, count: steps.length })}
            </p>
          </div>
          <DialogClose asChild>
            <Button
              type="button"
              variant="muted"
              size="icon"
              aria-label={t("guide.close")}
              title={t("guide.close")}
            >
              <X />
            </Button>
          </DialogClose>
        </div>
        <h3 className="font-semibold">{t(step.title)}</h3>
        <DialogDescription className="leading-relaxed">
          {t(step.description)}
        </DialogDescription>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((at + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className="flex gap-3">
          {/* aria-disabled rather than disabled, so focus stays on it after going back to the first step */}
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            aria-disabled={at === 0}
            onClick={() => at > 0 && setIndex(at - 1)}
          >
            <ChevronLeft />
            {t("guide.back")}
          </Button>
          <Button ref={next} type="button" className="flex-1" onClick={forward}>
            {last ? t("guide.finish") : t("guide.next")}
            <ChevronRight />
          </Button>
        </div>
        {at === 0 && firstStep}
      </DialogContent>
    </Dialog>
  );
}
