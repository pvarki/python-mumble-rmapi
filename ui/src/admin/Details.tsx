import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { api, type Access, type ChannelEdit } from "../api";
import { NS, RAW } from "../i18n";
import {
  ArrowLeft,
  CornerLeftUp,
  Flag,
  Loader,
  Lock,
  Pencil,
  Plus,
  Trash,
  X,
} from "../icons";
import {
  ancestors,
  focusAfterRemove,
  pathLabel,
  type MissionNode,
  type NetNode,
  type Rule,
} from "../paths";
import * as ui from "../ui";
import { MemberPicker } from "./MemberPicker";
import { InlineConfirm, NameForm, adding, ruleSentence } from "./NetTree";
import type { Mode, TreeCtx } from "./types";

function InNet({ callsigns }: { callsigns: string[] }) {
  const { t } = useTranslation(NS);
  if (!callsigns.length) return null;
  return (
    <p className={ui.INNET}>
      <span className={ui.DOT_ON} />
      {t("admin.inNetNow")}
      <span className={ui.INNET_WHO}>{callsigns.join(", ")}</span>
    </p>
  );
}

function AccessLine({ rule }: { rule: Rule }) {
  const { t } = useTranslation(NS);
  const Icon =
    rule.kind === "follows" ? CornerLeftUp : rule.kind === "open" ? null : Lock;
  return (
    <p className={ui.ACCESS_LINE}>
      {Icon && <Icon className={ui.ACCESS_ICON} />}
      {ruleSentence(t, rule)}
    </p>
  );
}

const CHOICES: [Access, string][] = [
  ["open", "admin.choiceOpen"],
  ["invite", "admin.choiceInvite"],
  ["inherit", "admin.choiceInherit"],
];

// Open, members only, or (below the top level) as the net above. A choice changes who can talk at once, so
// arrow keys only move focus; Space, Enter or a click chooses.
function AccessChoice({
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

// The open net's name and description; Enter in the name saves, Esc cancels
function EditForm({
  node,
  ctx,
  onDone,
}: {
  node: NetNode;
  ctx: TreeCtx;
  onDone: () => void;
}) {
  const { t } = useTranslation(NS);
  const { channel } = node;
  const warnId = useId();
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const key = `edit:${channel.id}`;
  const renamed = name.trim() !== channel.name;
  // Murmur recreates a renamed net, so the warning is read out with the name field and Save
  const warn = renamed && node.subtreeOnline;
  const describedBy = warn ? warnId : undefined;
  const ready =
    name.trim() !== "" && (renamed || description !== channel.description);
  const save = () => {
    if (!ready) return;
    const edit: ChannelEdit = {};
    if (renamed) edit.name = name.trim();
    if (description !== channel.description) edit.description = description;
    void ctx.run(key, () => api.editChannel(channel.id, edit), onDone);
  };
  return (
    <form
      className={ui.EDIT}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDone();
        }
      }}
    >
      <label className={ui.FIELD}>
        <span className={ui.FIELD_LABEL}>{t("admin.netName")}</span>
        <input
          autoFocus
          type="text"
          maxLength={100}
          className={ui.INPUT_SM}
          aria-describedby={describedBy}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className={ui.FIELD}>
        <span className={ui.FIELD_LABEL}>{t("admin.description")}</span>
        <textarea
          maxLength={1000}
          className={ui.TEXTAREA}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {warn && (
        <p id={warnId} className={ui.MUTED_XS}>
          {t("admin.renameMovesOut")}
        </p>
      )}
      <div className={ui.FORM_BTNS}>
        <button
          type="button"
          className={ui.cx(ui.BTN_SM, ui.SM_GHOST, ui.CONFIRM_CANCEL)}
          onClick={onDone}
        >
          {t("admin.cancel")}
        </button>
        {ready ? (
          <button
            type="submit"
            className={ui.cx(ui.BTN_SM, ui.SM_PRIMARY)}
            aria-describedby={describedBy}
          >
            {ctx.pending.has(key) && <Loader className={ui.LOADER} />}
            {t("admin.save")}
          </button>
        ) : (
          <button type="button" className={ui.SM_INERT} aria-disabled="true">
            {t("admin.save")}
          </button>
        )}
      </div>
    </form>
  );
}

// The same details in two frames: a sticky panel beside the list on a wide workspace, or the net's own
// screen with a sticky back bar on a narrow one. The title takes focus once, right after the net was opened.
function Frame({
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

// Where focus goes once a picker, form or confirmation gives way to the plain details again
type Return =
  | "member"
  | "subnet"
  | "remove"
  | "edit"
  | { choice: Access }
  | { chip: string };

export function NetDetails({
  node,
  ctx,
  mode,
  notice,
}: {
  node: NetNode;
  ctx: TreeCtx;
  mode: Mode;
  notice: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const { channel } = node;
  const id = channel.id;
  const { byId } = ctx.derived;
  const members = [...channel.members].sort((a, b) => a.localeCompare(b));
  const revoked = new Set(
    ctx.users.filter((u) => u.revoked).map((u) => u.callsign),
  );
  const last = typeof mode === "object" && "last" in mode ? mode.last : null;
  const narrowTo =
    typeof mode === "object" && "access" in mode ? mode.access : null;
  const memberKey = (callsign: string) => `mem:${id}:${callsign}`;
  const subnetsId = useId();
  // Names added since the sub-net form opened, in the order they succeeded
  const [added, setAdded] = useState<string[]>([]);
  const chips = useRef<HTMLDivElement>(null);
  const addMember = useRef<HTMLButtonElement>(null);
  const addSubnet = useRef<HTMLButtonElement>(null);
  const removeNet = useRef<HTMLButtonElement>(null);
  const editNet = useRef<HTMLButtonElement>(null);
  const accessGroup = useRef<HTMLDivElement>(null);
  // After a chip's x removes it, focus moves to the next chip's x, or to '+ Jäsen'
  const refocus = useRef<{ callsign: string; index: number } | null>(null);
  const returnTo = useRef<Return | null>(null);

  useEffect(() => {
    const want = refocus.current;
    if (want && !channel.members.includes(want.callsign)) {
      refocus.current = null;
      const buttons = chips.current?.querySelectorAll("button");
      if (buttons?.length) {
        buttons[Math.min(want.index, buttons.length - 1)].focus();
      }
    }
    const back = returnTo.current;
    if (!back) return;
    const target =
      back === "member"
        ? addMember.current
        : back === "subnet"
          ? addSubnet.current
          : back === "remove"
            ? removeNet.current
            : back === "edit"
              ? editNet.current
              : "choice" in back
                ? accessGroup.current?.querySelector<HTMLElement>(
                    `[data-access="${back.choice}"]`,
                  )
                : ([
                    ...(chips.current?.querySelectorAll<HTMLElement>(
                      "[data-callsign]",
                    ) ?? []),
                  ].find((b) => b.dataset.callsign === back.chip) ??
                  addMember.current);
    if (target) {
      returnTo.current = null;
      target.focus();
    }
  });

  const backTo = (where: Return) => {
    returnTo.current = where;
    ctx.setMode("view");
  };

  // Removals still in flight count as done, so two quick x's cannot skip the guard
  const removeMember = (callsign: string) => {
    if (members.filter((m) => !ctx.pending.has(memberKey(m))).length > 1) {
      refocus.current = { callsign, index: members.indexOf(callsign) };
      void ctx
        .run(memberKey(callsign), () => api.removeMember(id, callsign))
        .then((ok) => {
          if (!ok) refocus.current = null;
        });
    } else {
      ctx.setMode({ last: callsign });
    }
  };

  const removeText = [
    node.descendants
      ? t("admin.confirmRemoveTree", {
          name: channel.name,
          count: node.descendants,
          ...RAW,
        })
      : t("admin.confirmRemove", { name: channel.name, ...RAW }),
    node.subtreeOnline && t("admin.movesOut"),
  ]
    .filter(Boolean)
    .join(" ");

  // Members only on a net with nobody in it would lock everyone out, the people about to be added too, so the
  // picker opens instead: the first member makes the net members-only. A change that lets fewer people in asks
  // first while anyone is connected.
  const admitsAll = (access: Access) =>
    access === "open" || (access === "inherit" && !node.above?.invite);
  const chooseAccess = (next: Access) => {
    if (next === "invite" && !members.length) {
      ctx.setMode("picker");
      return;
    }
    const narrows =
      !admitsAll(next) &&
      (admitsAll(channel.access) ||
        (channel.access === "invite" && members.length > 0));
    if (narrows && node.subtreeOnline) {
      ctx.setMode({ access: next });
      return;
    }
    ctx.setMode("view");
    void ctx.run(`acc:${id}`, () => api.editChannel(id, { access: next }));
  };

  const above = ancestors(id, byId).map((a) => byId.get(a)?.channel.name);
  const path = above.length ? `${above.join(" › ")} ›` : "";
  const hasDesc = channel.description !== "";

  return (
    <Frame
      ctx={ctx}
      netKey={`u:${id}`}
      path={path}
      name={channel.name}
      testId="net-panel"
      action={
        mode !== "edit" && (
          <button
            ref={editNet}
            type="button"
            className={ctx.wide ? ui.ICON_BTN_GHOST : ui.BAR_BTN}
            data-testid="edit-net"
            aria-label={t("admin.editNet")}
            title={t("admin.editNet")}
            onClick={() => ctx.setMode("edit")}
          >
            <Pencil className={ui.ICON} />
          </button>
        )
      }
    >
      {notice}
      {mode === "edit" ? (
        // Alone while editing, so nothing else can close the form and lose what was typed
        <EditForm node={node} ctx={ctx} onDone={() => backTo("edit")} />
      ) : (
        <>
          {hasDesc && <p className={ui.PANEL_DESC}>{channel.description}</p>}
          {/* On the phone screen the bar's own border already separates a net without a description */}
          <div
            className={ui.cx(
              ui.DETAIL_BODY,
              (ctx.wide || hasDesc) && ui.DETAIL_SPLIT,
            )}
          >
            <AccessChoice
              node={node}
              ctx={ctx}
              group={accessGroup}
              onChoose={chooseAccess}
            />
            {/* The sentence only where the choice alone does not say it all: whose members, or which net */}
            {(channel.access === "inherit" ||
              node.rule.kind === "membersPlus") && (
              <AccessLine rule={node.rule} />
            )}
            {narrowTo !== null ? (
              <InlineConfirm
                text={t("admin.confirmNarrow")}
                busy={ctx.pending.has(`acc:${id}`)}
                confirmLabel={t("admin.change")}
                onCancel={() => backTo({ choice: channel.access })}
                onConfirm={() =>
                  void ctx.run(
                    `acc:${id}`,
                    () => api.editChannel(id, { access: narrowTo }),
                    () => backTo({ choice: narrowTo }),
                  )
                }
              />
            ) : channel.access !== "invite" ? (
              mode !== "picker" &&
              members.length > 0 && (
                <p className={ui.MUTED_XS}>
                  {t("admin.membersKept", { count: members.length })}
                </p>
              )
            ) : last !== null ? (
              <InlineConfirm
                text={
                  node.rule.kind === "membersPlus"
                    ? t("admin.lastMemberOnly", {
                        callsign: last,
                        count: node.rule.nets.length,
                        nets: node.rule.nets.join(", "),
                        ...RAW,
                      })
                    : t("admin.lastMemberNobody", { callsign: last, ...RAW })
                }
                busy={ctx.pending.has(memberKey(last))}
                onCancel={() => backTo({ chip: last })}
                onConfirm={() =>
                  void ctx.run(
                    memberKey(last),
                    () => api.removeMember(id, last),
                    () => backTo("member"),
                  )
                }
              />
            ) : (
              <div ref={chips} className={ui.CHIPS_ROW}>
                {members.map((callsign) => {
                  const where = ctx.derived.whereOnline.get(callsign);
                  const gone = revoked.has(callsign);
                  return (
                    <span
                      key={callsign}
                      className={ui.cx(ui.CHIP_X, gone && ui.CHIP_DIM)}
                      title={
                        gone
                          ? t("admin.revoked")
                          : where?.map(pathLabel).join(", ")
                      }
                    >
                      {where && (
                        <>
                          <span className={ui.DOT_ON} />
                          <span className={ui.SR}>{t("admin.isOnline")}</span>
                        </>
                      )}
                      <span className={ui.CHIP_TEXT}>{callsign}</span>
                      <button
                        type="button"
                        className={ui.CHIP_X_BTN}
                        data-callsign={callsign}
                        aria-label={t("admin.removeMember", {
                          callsign,
                          ...RAW,
                        })}
                        aria-disabled={
                          ctx.pending.has(memberKey(callsign)) || undefined
                        }
                        onClick={() => removeMember(callsign)}
                      >
                        <X className={ui.ICON_META} />
                      </button>
                    </span>
                  );
                })}
                {mode !== "picker" && (
                  <button
                    ref={addMember}
                    type="button"
                    className={ui.CHIP_ADD}
                    onClick={() => ctx.setMode("picker")}
                  >
                    <Plus className={ui.ICON_META} />
                    {t("admin.addMember")}
                  </button>
                )}
              </div>
            )}
            {mode === "picker" && (
              <MemberPicker
                node={node}
                ctx={ctx}
                onClose={() =>
                  backTo(
                    channel.access === "invite"
                      ? "member"
                      : { choice: channel.access },
                  )
                }
              />
            )}
            <InNet callsigns={node.online} />
            {node.children.length > 0 && (
              <div
                role="group"
                aria-labelledby={subnetsId}
                className={ui.SUBNETS}
              >
                <span id={subnetsId}>{t("admin.subnets")}</span>
                {node.children.map((child) => (
                  <button
                    key={child.channel.id}
                    type="button"
                    className={ui.SUBNET_LINK}
                    data-testid="subnet-link"
                    onClick={() => ctx.openNet(`u:${child.channel.id}`)}
                  >
                    {child.channel.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mode === "view" && (
            <div className={ui.DETAIL_FOOT}>
              <button
                ref={addSubnet}
                type="button"
                className={ui.cx(ui.LINK_BTN, ui.LINK_MUTED)}
                onClick={() => {
                  setAdded([]);
                  ctx.setMode("subnet");
                }}
              >
                <Plus className={ui.ICON_META} />
                {t("admin.addSubnet")}
              </button>
              <button
                ref={removeNet}
                type="button"
                className={ui.cx(ui.LINK_BTN, ui.LINK_DANGER)}
                onClick={() => ctx.setMode("remove")}
              >
                <Trash className={ui.cx(ui.ICON_META, ui.LINK_DANGER_ICON)} />
                {t("admin.removeNet")}
              </button>
            </div>
          )}
          {mode === "subnet" && (
            <div className={ui.DETAIL_FOOT_BLOCK}>
              <NameForm
                placeholder={t("admin.subnetName")}
                busy={adding(ctx.pending, id)}
                onCancel={() => backTo("subnet")}
                onSubmit={(name) =>
                  ctx.run(
                    `add:${id}:${name}`,
                    () => api.addChannel(name, id),
                    () => {
                      ctx.setExpanded(id, true);
                      setAdded((names) => [...names, name]);
                    },
                  )
                }
              />
              {added.length > 0 && (
                <p role="status" className={ui.MUTED_XS}>
                  {t("admin.added", { names: added.join(", "), ...RAW })}
                </p>
              )}
            </div>
          )}
          {mode === "remove" && (
            <div className={ui.DETAIL_FOOT_BLOCK}>
              <InlineConfirm
                text={removeText}
                busy={ctx.pending.has(`rm:${id}`)}
                onCancel={() => backTo("remove")}
                onConfirm={() =>
                  void ctx.run(
                    `rm:${id}`,
                    () => api.removeChannel(id),
                    () => {
                      const next = focusAfterRemove(node, ctx.derived.roots);
                      ctx.closeNet(next === null ? null : `u:${next}`);
                    },
                  )
                }
              />
            </div>
          )}
        </>
      )}
    </Frame>
  );
}

// Read-only: subscribers are managed in ATAK Data Sync
export function MissionDetails({
  node,
  ctx,
  notice,
}: {
  node: MissionNode;
  ctx: TreeCtx;
  notice: ReactNode;
}) {
  const { t } = useTranslation(NS);
  const { name } = node.mission;
  return (
    <Frame
      ctx={ctx}
      netKey={`m:${name}`}
      path={t("admin.missions")}
      name={name}
      testId="mission-panel"
    >
      {notice}
      <div className={ui.cx(ui.DETAIL_BODY, ctx.wide && ui.DETAIL_SPLIT)}>
        <p className={ui.ACCESS_LINE}>
          {!node.mission.open && <Flag className={ui.ACCESS_ICON} />}
          {t(node.mission.open ? "admin.missionOpen" : "admin.accessMission")}
        </p>
        <div className={ui.CHIPS_ROW}>
          {node.subscribers.map((s) => (
            <span
              key={s.callsign}
              className={ui.cx(ui.CHIP, !s.known && ui.CHIP_DIM)}
              title={
                s.known
                  ? ctx.derived.whereOnline
                      .get(s.callsign)
                      ?.map(pathLabel)
                      .join(", ")
                  : t("admin.notUser")
              }
            >
              {s.online && (
                <>
                  <span className={ui.DOT_ON} />
                  <span className={ui.SR}>{t("admin.isOnline")}</span>
                </>
              )}
              {s.callsign}
            </span>
          ))}
        </div>
        <InNet callsigns={node.online} />
      </div>
    </Frame>
  );
}
