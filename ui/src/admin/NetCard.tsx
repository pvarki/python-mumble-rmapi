import { ChevronRight, CornerLeftUp, Lock } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "../i18n";
import { cn } from "../lib/utils";
import * as ui from "../ui";
import { takeAsked, type FocusTarget } from "./hooks/useFocusRequests";
import { OnlineCell } from "./OnlineCell";
import { ruleSentence } from "./ruleSentence";
import { groupOnline, type NetNode, type Rule } from "./tree";
import type { TreeCtx } from "./types";

function AccessMark({ rule, count }: { rule: Rule; count: number }) {
  const { t } = useTranslation(NS);
  const sentence = ruleSentence(t, rule);
  if (rule.kind === "members" || rule.kind === "membersPlus") {
    const label = `${sentence}, ${t("admin.memberCount", { count })}`;
    return (
      <span className={ui.ACC_MEMBERS} title={sentence} aria-label={label}>
        <Lock className={ui.ICON_META} />
        <span className={ui.ACC_WORD}>{t("admin.rowMembers")}</span>
        {count}
      </span>
    );
  }
  if (rule.kind === "follows") {
    return (
      <span className={ui.ACC_FOLLOWS} title={sentence} aria-label={sentence}>
        <CornerLeftUp className={ui.ICON_META} />
        <span className={ui.ACC_WORD}>
          {t("admin.rowFollows", { net: rule.net, ...RAW })}
        </span>
      </span>
    );
  }
  return null;
}

// One row of a card and, unless folded, its sub-nets as further rows of the same card. The chevron only
// folds; the rest of the row opens the net. Nothing else ever renders inside a card.
function NetRow({ node, ctx }: { node: NetNode; ctx: TreeCtx }) {
  const { t } = useTranslation(NS);
  const main = useRef<HTMLButtonElement>(null);
  const fold = useRef<HTMLButtonElement>(null);
  const nameId = useId();
  const { channel, depth } = node;
  const key = `u:${channel.id}`;

  // Runs after every render, so the control asked for takes focus as soon as it exists
  useEffect(() => {
    const ask = (part: FocusTarget["part"]) => ctx.takeFocus(key, part);
    takeAsked(main.current, ask, "row");
    takeAsked(fold.current, ask, "fold");
  });

  const hasFold = channel.children.length > 0 && !ctx.searching;
  const expanded = ctx.searching || ctx.isExpanded(channel.id);
  const folded = hasFold && !expanded;
  const selected = ctx.wide && ctx.open?.key === key;
  const marked = selected || ctx.markedFold === channel.id;
  const children = expanded ? node.children.filter((c) => c.visible) : [];
  const indent = Array.from({ length: depth }, (_, i) => (
    <span key={i} className={ui.INDENT} />
  ));

  const mainButton = (lead: ReactNode) => (
    <button
      ref={main}
      type="button"
      className={cn(ui.ROW_MAIN, !node.match && ui.ROW_CONTEXT)}
      data-testid="row"
      aria-current={selected || undefined}
      aria-controls={selected ? ctx.detailsId : undefined}
      onClick={() => ctx.openNet(key)}
    >
      {lead}
      <span
        id={nameId}
        className={depth ? ui.NAME_SUB : ui.NAME}
        title={channel.name}
      >
        {channel.name}
      </span>
      <span className={ui.DESC} title={channel.description || undefined}>
        {channel.description}
      </span>
      <span className={ui.META}>
        {folded && (
          <span className={ui.FOLDED}>
            {t("admin.subnetsFolded", { count: node.descendants })}
          </span>
        )}
        <AccessMark rule={node.rule} count={channel.members.length} />
        <OnlineCell
          count={folded ? groupOnline(node) : node.online.length}
          known={ctx.derived.presenceKnown}
          group={folded}
        />
      </span>
    </button>
  );

  return (
    <>
      <div
        className={cn(
          ui.ROW,
          depth > 0 && ui.ROW_SUB,
          selected ? ui.ROW_ON : ui.ROW_IDLE,
        )}
      >
        {marked && <span className={ui.SEL_BAR} aria-hidden="true" />}
        {hasFold ? (
          <>
            {indent}
            <button
              ref={fold}
              type="button"
              className={ui.CHEVRON}
              data-testid="fold"
              aria-expanded={expanded}
              aria-label={t(
                expanded ? "admin.hideSubnets" : "admin.showSubnets",
              )}
              aria-describedby={nameId}
              onClick={() => ctx.setExpanded(channel.id, !expanded)}
            >
              <ChevronRight
                className={cn(ui.CHEVRON_SVG, expanded && ui.CHEVRON_OPEN)}
              />
            </button>
            {mainButton(null)}
          </>
        ) : (
          // Without a chevron the whole row, lead column included, is the button
          mainButton(
            <span className={ui.LEAD_WRAP}>
              {indent}
              <span className={ui.LEAD} />
            </span>,
          )
        )}
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <li
              key={child.channel.id}
              className={ui.SEP}
              data-testid={`net-${child.channel.name}`}
            >
              <NetRow node={child} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// A top-level net and its sub-nets; a net without sub-nets is a one-row card
export function NetCard({ node, ctx }: { node: NetNode; ctx: TreeCtx }) {
  if (!node.visible) return null;
  return (
    <li className={ui.CARD} data-testid={`net-${node.channel.name}`}>
      <NetRow node={node} ctx={ctx} />
    </li>
  );
}
