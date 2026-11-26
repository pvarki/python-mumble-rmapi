import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "../i18n";
import { ArrowLeft, X } from "../icons";
import * as ui from "../ui";
import type { TreeCtx } from "./types";

// The same details in two frames: a sticky panel beside the list on a wide workspace, or the net's own
// screen with a sticky back bar on a narrow one. The title takes focus once, right after the net was opened.
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

  useEffect(() => {
    if (!title.current || !ctx.takeTitleFocus(netKey)) return;
    if (!ctx.wide) section.current?.scrollIntoView({ block: "start" });
    title.current.focus({ preventScroll: true });
  });

  const heading = (
    <h2
      ref={title}
      id={titleId}
      tabIndex={-1}
      className={ctx.wide ? ui.DETAIL_TITLE : ui.VIEW_TITLE}
    >
      {path && <span className={ui.TITLE_PATH}>{path}</span>}
      <span className={ctx.wide ? ui.TITLE_NAME : ui.VIEW_NAME}>{name}</span>
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
        className={ui.SIDE}
        style={ui.SIDE_STYLE}
      >
        <div className={ui.DETAIL_HEAD}>
          {heading}
          {action}
          <button
            type="button"
            className={ui.ICON_BTN_GHOST}
            data-testid="close-net"
            aria-label={t("admin.closeNet", { name, ...RAW })}
            title={t("admin.closeNet", { name, ...RAW })}
            onClick={close}
          >
            <X className={ui.ICON} />
          </button>
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
      className={ui.VIEW}
    >
      <div className={ui.VIEW_BAR}>
        <button
          type="button"
          className={ui.BACK_BTN}
          data-testid="back"
          aria-label={t("admin.back")}
          title={t("admin.back")}
          onClick={close}
        >
          <ArrowLeft className={ui.ICON} />
        </button>
        {heading}
        {action}
      </div>
      <div className={ui.VIEW_INNER}>{children}</div>
    </section>
  );
}
