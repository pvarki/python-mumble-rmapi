import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { Template } from "@/api";
import { Button } from "@/components/ui/button";
import { NS, RAW } from "@/i18n";

// Applying a template adds only the nets that are missing, so it is safe on a plan already in use
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
      className="space-y-2"
      data-testid="templates"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <h3
          ref={title}
          id={titleId}
          tabIndex={-1}
          className="min-w-0 flex-1 pl-1 text-sm font-semibold outline-none"
        >
          {t("admin.templatesTitle")}
        </h3>
        <Button
          type="button"
          variant="muted"
          size="icon"
          aria-label={t("admin.close")}
          aria-disabled={busy || undefined}
          onClick={close}
        >
          <X />
        </Button>
      </div>
      {hasNets && (
        <p className="px-1 text-xs text-muted-foreground">
          {t("admin.templatesKeep")}
        </p>
      )}
      <ul>
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex flex-wrap items-center gap-2 border-t border-border p-1 pt-2"
          >
            <div className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{template.name}</span>
              {template.description && (
                <span className="block text-xs text-muted-foreground">
                  {template.description}
                </span>
              )}
              <span className="block text-xs text-muted-foreground">
                {t("admin.templateNets", { count: template.nets })}
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              aria-label={t("admin.applyTemplate", {
                name: template.name,
                ...RAW,
              })}
              aria-disabled={pending.has(`tpl:${template.id}`) || undefined}
              onClick={() => onApply(template)}
            >
              {pending.has(`tpl:${template.id}`) && (
                <Loader2 className="animate-spin" />
              )}
              {t("admin.apply")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
