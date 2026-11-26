import { useId, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { Access } from "../api";
import { NS } from "../i18n";
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
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={ui.FIELD}>
      <span id={labelId} className={ui.FIELD_LABEL}>
        {t("admin.accessLabel")}
      </span>
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={labelId}
        className={ui.SEG}
        onKeyDown={(event) => {
          const step = {
            ArrowRight: 1,
            ArrowDown: 1,
            ArrowLeft: -1,
            ArrowUp: -1,
          }[event.key];
          if (step === undefined) return;
          event.preventDefault();
          const at = buttons.current.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next = (at + step + choices.length) % choices.length;
          buttons.current[next]?.focus();
        }}
      >
        {choices.map(([value, label], index) => (
          <button
            key={value}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
            role="radio"
            data-access={value}
            aria-checked={value === current}
            aria-disabled={ctx.pending.has(`acc:${id}`) || undefined}
            tabIndex={value === current ? 0 : -1}
            className={ui.cx(
              ui.SEG_OPT,
              value === current ? ui.TAB_ON : ui.TAB_OFF,
            )}
            onClick={() => {
              if (value !== current) onChoose(value);
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
    </div>
  );
}
