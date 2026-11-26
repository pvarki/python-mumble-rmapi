import { ArrowLeft, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { NS, RAW } from "@/i18n";
import { cn } from "@/lib/utils";
import { useFitsScreen } from "./hooks/useWide";
import type { TreeCtx } from "./types";

// The same details in two frames: a panel beside the list on a wide workspace, or the net's own screen with a
// sticky back bar on a narrow one. The title takes focus once, right after the net was opened.
export function Frame({
  ctx,
  netKey,
  path,
  name,
  testId,
  action,
  children,
}: {
  ctx: TreeCtx;
  netKey: string;
  path: string;
  name: string;
  testId: string;
  // A button beside the title, such as editing the net
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const titleId = useId();
  const section = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // The panel scrolls with the page, and stays in view only while that cannot hide its end
  const sticky = useFitsScreen(ctx.wide ? section : null);

  useEffect(() => {
    if (!title.current || !ctx.takeTitleFocus(netKey)) return;
    if (!ctx.wide) section.current?.scrollIntoView({ block: "start" });
    title.current.focus({ preventScroll: true });
  });

  // A panel that has outgrown the screen moves up with the list, so what has focus in it is brought back to view
  useEffect(() => {
    const focused = document.activeElement;
    if (
      !sticky &&
      focused instanceof HTMLElement &&
      section.current?.contains(focused)
    )
      focused.scrollIntoView({ block: "nearest" });
  }, [sticky]);

  const heading = (
    <h2
      ref={title}
      id={titleId}
      tabIndex={-1}
      className={cn("min-w-0 flex-1 outline-none", ctx.wide && "break-words")}
    >
      {path && (
        <span className="block truncate text-xs text-muted-foreground">
          {path}
        </span>
      )}
      <span
        className={cn(
          "block text-base font-semibold",
          ctx.wide ? "break-words" : "truncate",
        )}
      >
        {name}
      </span>
    </h2>
  );
  const close = () => ctx.closeNet();

  if (ctx.wide) {
    return (
      <section
        ref={section}
        id={ctx.detailsId}
        aria-labelledby={titleId}
        data-testid={testId}
        className={cn(
          "w-80 shrink-0 self-start space-y-3 rounded-lg border border-border bg-card p-4 text-sm",
          sticky && "sticky top-4",
        )}
      >
        <div className="flex items-start gap-2">
          {heading}
          {action}
          <Button
            type="button"
            variant="muted"
            size="icon"
            data-testid="close-net"
            aria-label={t("admin.closeNet", { name, ...RAW })}
            title={t("admin.closeNet", { name, ...RAW })}
            onClick={close}
          >
            <X />
          </Button>
        </div>
        {children}
      </section>
    );
  }
  return (
    <section
      ref={section}
      id={ctx.detailsId}
      aria-labelledby={titleId}
      data-testid={testId}
      className="min-h-svh"
    >
      <div className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-border bg-background">
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          data-testid="back"
          aria-label={t("admin.back")}
          title={t("admin.back")}
          onClick={close}
        >
          <ArrowLeft />
        </Button>
        {heading}
        {action}
      </div>
      <div className="space-y-3 py-4 text-sm">{children}</div>
    </section>
  );
}
