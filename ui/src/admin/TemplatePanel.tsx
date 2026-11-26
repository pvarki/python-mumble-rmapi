import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Template } from "../api";
import { NS, RAW } from "../i18n";
import { Loader, X } from "../icons";
import * as ui from "../ui";

// The channel plan templates on offer, at the top of the net list. Applying one adds the nets it has that are
// missing, so it is safe on a plan already in use.
export function TemplatePanel({
  templates,
  hasNets,
  pending,
  onApply,
  onClose,
}: {
  templates: Template[];
  hasNets: boolean;
  pending: Set<string>;
  onApply: (template: Template) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(NS);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  // While a template is being applied, closing would only look like a cancel
  const busy = [...pending].some((key) => key.startsWith("tpl:"));
  const close = () => {
    if (!busy) onClose();
  };

  useEffect(() => title.current?.focus(), []);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={ui.PLAN}
      data-testid="templates"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className={ui.PLAN_HEAD}>
        <h3 ref={title} id={titleId} tabIndex={-1} className={ui.PLAN_TITLE}>
          {t("admin.templatesTitle")}
        </h3>
        <button
          type="button"
          className={ui.ICON_BTN_GHOST}
          aria-label={t("admin.close")}
          aria-disabled={busy || undefined}
          onClick={close}
        >
          <X className={ui.ICON} />
        </button>
      </div>
      {hasNets && <p className={ui.PLAN_NOTE}>{t("admin.templatesKeep")}</p>}
      <ul>
        {templates.map((template) => (
          <li key={template.id} className={ui.PLAN_ITEM}>
            <div className={ui.PLAN_TEXT}>
              <span className={ui.PLAN_NAME}>{template.name}</span>
              {template.description && (
                <span className={ui.PLAN_DESC}>{template.description}</span>
              )}
              <span className={ui.PLAN_DESC}>
                {t("admin.templateNets", { count: template.nets })}
              </span>
            </div>
            <button
              type="button"
              className={ui.cx(ui.BTN_SM, ui.SM_PRIMARY)}
              aria-label={t("admin.applyTemplate", {
                name: template.name,
                ...RAW,
              })}
              aria-disabled={pending.has(`tpl:${template.id}`) || undefined}
              onClick={() => onApply(template)}
            >
              {pending.has(`tpl:${template.id}`) && (
                <Loader className={ui.LOADER} />
              )}
              {t("admin.apply")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
