import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { useId, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { Access } from "../api";
import { NS } from "../i18n";
import { cn } from "../lib/utils";
import * as ui from "../ui";
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
  const current = choices.some(([value]) => value === access) ? access : "open";
  return (
    <div className={ui.FIELD}>
      <span id={labelId} className={ui.FIELD_LABEL}>
        {t("admin.accessLabel")}
      </span>
      <ToggleGroup.Root
        ref={group}
        type="single"
        value={current}
        onValueChange={(v) => v && v !== current && onChoose(v as Access)}
        aria-labelledby={labelId}
        className={ui.SEG}
      >
        {choices.map(([value, label]) => (
          <ToggleGroup.Item
            key={value}
            value={value}
            data-access={value}
            aria-disabled={ctx.pending.has(`acc:${id}`) || undefined}
            className={cn(
              ui.SEG_OPT,
              value === current ? ui.TAB_ON : ui.TAB_OFF,
            )}
          >
            {t(label)}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}
