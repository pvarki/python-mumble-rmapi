import { ChevronRight, CornerLeftUp, Lock } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { NS, RAW } from "@/i18n";
import { cn } from "@/lib/utils";
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
      <span
        className="inline-flex items-center gap-1 text-foreground"
        title={sentence}
        aria-label={label}
      >
        <Lock className="size-3.5 shrink-0" />
        <span className="hidden md:inline">{t("admin.rowMembers")}</span>
        {count}
      </span>
    );
  }
  if (rule.kind === "follows") {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground"
        title={sentence}
        aria-label={sentence}
      >
        <CornerLeftUp className="size-3.5 shrink-0" />
        <span className="hidden md:inline">
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
    <span key={i} className="w-4 shrink-0" />
  ));

  const mainButton = (lead: ReactNode) => (
    <button
      ref={main}
      type="button"
      // An inset focus border: the card's overflow-hidden would clip a ring
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 rounded-md border-2 border-transparent py-2 pr-2 text-left text-sm outline-none focus-visible:border-ring",
        !node.match && "opacity-50",
      )}
      data-testid="row"
      aria-current={selected || undefined}
      aria-controls={selected ? ctx.detailsId : undefined}
      onClick={() => ctx.openNet(key)}
    >
      {lead}
      <span
        id={nameId}
        className={cn(
          "min-w-0 truncate",
          depth ? "font-medium" : "font-semibold",
        )}
        title={channel.name}
      >
        {channel.name}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={channel.description || undefined}
      >
        {channel.description}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
        {folded && (
          <span className="hidden text-muted-foreground md:inline">
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
          "relative flex h-11 items-stretch",
          depth > 0 && "md:h-auto",
          selected ? "bg-muted" : "hover:bg-muted/50",
        )}
      >
        {marked && (
          <span
            className="pointer-events-none absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-foreground"
            aria-hidden="true"
          />
        )}
        {hasFold ? (
          <>
            {indent}
            <button
              ref={fold}
              type="button"
              className="flex w-10 shrink-0 items-center justify-center rounded-md border-2 border-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring"
              data-testid="fold"
              aria-expanded={expanded}
              aria-label={t(
                expanded ? "admin.hideSubnets" : "admin.showSubnets",
              )}
              aria-describedby={nameId}
              onClick={() => ctx.setExpanded(channel.id, !expanded)}
            >
              <ChevronRight
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-90",
                )}
              />
            </button>
            {mainButton(null)}
          </>
        ) : (
          // Without a chevron the whole row, lead column included, is the button
          mainButton(
            <span className="flex shrink-0">
              {indent}
              <span className="flex w-8 shrink-0 items-center justify-center" />
            </span>,
          )
        )}
      </div>
      {children.length > 0 && (
        <ul className="divide-y border-t">
          {children.map((child) => (
            <li
              key={child.channel.id}
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
    <li
      className="overflow-hidden rounded-lg border border-border bg-card"
      data-testid={`net-${node.channel.name}`}
    >
      <NetRow node={node} ctx={ctx} />
    </li>
  );
}
