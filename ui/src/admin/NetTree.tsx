import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { NS, RAW } from "../i18n";
import {
  ChevronRight,
  CornerLeftUp,
  Flag,
  Loader,
  Lock,
  Users,
  X,
} from "../icons";
import {
  groupOnline,
  type MissionNode,
  type NetNode,
  type Rule,
} from "../paths";
import * as ui from "../ui";
import type { FocusTarget, TreeCtx } from "./types";

// The rule in one sentence, naming the nets that restrict it
export function ruleSentence(t: TFunction, rule: Rule): string {
  switch (rule.kind) {
    case "members":
      return t("admin.accessMembers");
    case "membersPlus":
      return t("admin.accessMembersPlus", {
        count: rule.nets.length,
        nets: rule.nets.join(", "),
        ...RAW,
      });
    case "follows":
      return t("admin.accessSameAs", { net: rule.net, ...RAW });
    case "open":
      return t("admin.accessOpen");
  }
}

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

// Always rendered, so the green counts line up in one column. A folded row counts its whole group.
function OnlineCell({
  count,
  known,
  group = false,
}: {
  count: number;
  known: boolean;
  group?: boolean;
}) {
  const { t } = useTranslation(NS);
  const show = known && count > 0;
  return (
    <span
      className={ui.CELL_ONLINE}
      aria-label={
        show
          ? t(group ? "admin.groupOnline" : "admin.onlineCount", { count })
          : undefined
      }
    >
      {show && (
        <>
          <span className={ui.DOT_ON} />
          {count}
        </>
      )}
    </span>
  );
}

// Focuses a row control once it was asked for; centred first when coming back from a phone's net screen
function takeAsked(
  element: HTMLElement | null,
  ask: (part: FocusTarget["part"]) => FocusTarget | null,
  part: FocusTarget["part"],
) {
  const target = element && ask(part);
  if (!element || !target) return;
  if (target.center) element.scrollIntoView({ block: "center" });
  element.focus({ preventScroll: target.center });
}

// Replaces window.confirm; the safe choice, Peruuta, has focus. extra sits on the left, before the choice.
// While the request runs, cancelling would only look like it worked, so it waits.
export function InlineConfirm({
  text,
  busy,
  onCancel,
  onConfirm,
  confirmLabel,
  extra,
}: {
  text: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  extra?: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const id = useId();
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <div
      role="alertdialog"
      aria-labelledby={id}
      className={ui.CONFIRM}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <p id={id} className={ui.CONFIRM_TEXT}>
        {text}
      </p>
      {extra}
      <div className={ui.CONFIRM_BTNS}>
        <button
          type="button"
          autoFocus
          className={ui.cx(ui.BTN_SM, ui.SM_GHOST)}
          aria-disabled={busy || undefined}
          onClick={cancel}
        >
          {t("admin.cancel")}
        </button>
        <button
          type="button"
          className={ui.cx(ui.BTN_SM, ui.SM_DANGER)}
          aria-disabled={busy || undefined}
          onClick={onConfirm}
        >
          {confirmLabel ?? t("admin.remove")}
        </button>
      </div>
    </div>
  );
}

// Adds are keyed per name, so several can be in flight; the form only shows that one is
export function adding(pending: Set<string>, parent: number): boolean {
  return [...pending].some((key) => key.startsWith(`add:${parent}:`));
}

// A new top-level net or sub-net. Stays open after a success so the next squad is one more Enter.
export function NameForm({
  placeholder,
  busy,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  busy: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation(NS);
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ready = name.trim() !== "";
  // The field empties at once, so the next squad can be typed while this one is still being saved;
  // a failed name comes back unless something new has been typed meanwhile.
  const submit = () => {
    const sent = name.trim();
    if (!sent) return;
    setName("");
    input.current?.focus();
    void onSubmit(sent).then((ok) => {
      if (!ok) setName((current) => (current === "" ? sent : current));
    });
  };
  return (
    <div className={ui.FORM}>
      <input
        ref={input}
        autoFocus
        type="text"
        className={ui.INPUT_SM}
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      {ready ? (
        <button
          type="button"
          className={ui.cx(ui.BTN_SM, ui.SM_PRIMARY)}
          onClick={submit}
        >
          {busy && <Loader className={ui.LOADER} />}
          {t("admin.add")}
        </button>
      ) : (
        <button type="button" className={ui.SM_INERT} aria-disabled="true">
          {t("admin.add")}
        </button>
      )}
      <button
        type="button"
        className={ui.ICON_BTN_GHOST}
        aria-label={t("admin.cancel")}
        onClick={onCancel}
      >
        <X className={ui.ICON} />
      </button>
    </div>
  );
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
      className={ui.cx(ui.ROW_MAIN, !node.match && ui.ROW_CONTEXT)}
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
        className={ui.cx(
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
                className={ui.cx(ui.CHEVRON_SVG, expanded && ui.CHEVRON_OPEN)}
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

// Read-only: subscribers are managed in ATAK Data Sync. All missions share one card.
export function MissionRow({
  node,
  ctx,
  first,
}: {
  node: MissionNode;
  ctx: TreeCtx;
  first: boolean;
}) {
  const { t } = useTranslation(NS);
  const main = useRef<HTMLButtonElement>(null);
  const { name } = node.mission;
  const key = `m:${name}`;
  const selected = ctx.wide && ctx.open?.key === key;

  useEffect(() => {
    takeAsked(main.current, (part) => ctx.takeFocus(key, part), "row");
  });

  return (
    <li className={first ? undefined : ui.SEP} data-testid={`mission-${name}`}>
      <div className={ui.cx(ui.ROW, selected ? ui.ROW_ON : ui.ROW_IDLE)}>
        {selected && <span className={ui.SEL_BAR} aria-hidden="true" />}
        <button
          ref={main}
          type="button"
          className={ui.ROW_MAIN}
          data-testid="row"
          aria-current={selected || undefined}
          aria-controls={selected ? ctx.detailsId : undefined}
          onClick={() => ctx.openNet(key)}
        >
          <span className={ui.LEAD}>
            <Flag className={ui.FLAG} />
          </span>
          <span className={ui.NAME} title={name}>
            {name}
          </span>
          <span className={ui.DESC}>
            {node.mission.open && t("admin.missionOpen")}
          </span>
          <span className={ui.META}>
            {!node.mission.open && (
              <span className={ui.ACC_FOLLOWS}>
                <Users className={ui.ICON_META} />
                <span className={ui.ACC_WORD}>{t("admin.rowSubscribers")}</span>
                {node.subscribers.length}
              </span>
            )}
            <OnlineCell
              count={node.online.length}
              known={ctx.derived.presenceKnown}
            />
          </span>
        </button>
      </div>
    </li>
  );
}
