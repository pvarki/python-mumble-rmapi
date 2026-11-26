import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { useId, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { Access } from "@/api";
import { NS } from "@/i18n";
import { cn } from "@/lib/utils";
import type { NetNode } from "./tree";
import type { TreeCtx } from "./types";

const CHOICES: [Access, string][] = [
  ["open", "admin.choiceOpen"],
  ["invite", "admin.choiceInvite"],
  ["inherit", "admin.choiceInherit"],
];

// Open, members only, or (below the top level) as the net above. A choice changes who can talk at once, so
// arrow keys only move focus; Space, Enter or a click chooses.
export function AccessChoice({
  node,
  ctx,
  group,
  onChoose,
}: {
  node: NetNode;
  ctx: TreeCtx;
  group: RefObject<HTMLDivElement>;
  onChoose: (access: Access) => void;
}) {
  const { t } = useTranslation(NS);
  const { id, access } = node.channel;
  const labelId = useId();
  const choices = node.depth ? CHOICES : CHOICES.slice(0, 2);
  return (
    <div className="block space-y-1">
      <span id={labelId} className="block text-xs text-muted-foreground">
        {t("admin.accessLabel")}
      </span>
      <ToggleGroup.Root
        ref={group}
        type="single"
        value={access}
        onValueChange={(v) => v && v !== access && onChoose(v as Access)}
        aria-labelledby={labelId}
        className="inline-flex h-12 w-full items-center rounded-lg bg-muted p-px"
      >
        {choices.map(([value, label]) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            data-access={value}
            aria-disabled={ctx.pending.has(`acc:${id}`) || undefined}
            // Chosen in JS: rmui's CSS has data-[state=on] only with accent, which follows the theme
            className={cn(
              "inline-flex h-[calc(100%-1px)] min-w-0 grow items-center justify-center whitespace-nowrap rounded-md px-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50",
              value === access
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(label)}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
