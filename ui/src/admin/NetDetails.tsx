import { CornerLeftUp, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { api, type Access } from "../api";
import { Button } from "../components/ui/button";
import { NS, RAW } from "../i18n";
import { cn } from "../lib/utils";
import * as ui from "../ui";
import { AccessChoice } from "./AccessChoice";
import { EditForm } from "./EditForm";
import { Frame } from "./Frame";
import { InNet } from "./InNet";
import { MemberChips, memberKey } from "./MemberChips";
import { MemberPicker } from "./MemberPicker";
import { NameForm, adding } from "./NameForm";
import { NetConfirm } from "./NetConfirm";
import { ruleSentence } from "./ruleSentence";
import { ancestors, type NetNode, type Rule } from "./tree";
import type { Mode, ReturnTo, TreeCtx } from "./types";

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
  const returnTo = useRef<ReturnTo | null>(null);

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
    const buttons = {
      member: addMember,
      subnet: addSubnet,
      remove: removeNet,
      edit: editNet,
    };
    const target =
      typeof back === "string"
        ? buttons[back].current
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

  const backTo = (where: ReturnTo) => {
    returnTo.current = where;
    ctx.setMode("view");
  };

  // Removals still in flight count as done, so two quick x's cannot skip the guard
  const removeMember = (callsign: string) => {
    if (members.filter((m) => !ctx.pending.has(memberKey(id, m))).length > 1) {
      refocus.current = { callsign, index: members.indexOf(callsign) };
      void ctx
        .run(memberKey(id, callsign), () => api.removeMember(id, callsign))
        .then((ok) => {
          if (!ok) refocus.current = null;
        });
    } else {
      ctx.setMode({ last: callsign });
    }
  };

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

  // Behind a confirmation the details stay as they are, so Cancel finds the button it came from
  const confirming = mode === "remove" || typeof mode === "object";

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
          <Button
            ref={editNet}
            type="button"
            variant="ghost"
            size={ctx.wide ? "icon" : "icon-lg"}
            className={ui.MUTED_BTN}
            data-testid="edit-net"
            aria-label={t("admin.editNet")}
            title={t("admin.editNet")}
            onClick={() => ctx.setMode("edit")}
          >
            <Pencil />
          </Button>
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
            className={cn(
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
            {channel.access !== "invite" ? (
              mode !== "picker" &&
              members.length > 0 && (
                <p className={ui.MUTED_XS}>
                  {t("admin.membersKept", { count: members.length })}
                </p>
              )
            ) : (
              <MemberChips
                id={id}
                ctx={ctx}
                members={members}
                picking={mode === "picker"}
                chips={chips}
                addMember={addMember}
                onRemove={removeMember}
              />
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
                  <Button
                    key={child.channel.id}
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={ui.SUBNET_LINK}
                    data-testid="subnet-link"
                    onClick={() => ctx.openNet(`u:${child.channel.id}`)}
                  >
                    {child.channel.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
          {(mode === "view" || confirming) && (
            <div className={ui.DETAIL_FOOT}>
              <Button
                ref={addSubnet}
                type="button"
                variant="ghost"
                size="xs"
                className={ui.MUTED_BTN}
                onClick={() => {
                  setAdded([]);
                  ctx.setMode("subnet");
                }}
              >
                <Plus className={ui.ICON_META} />
                {t("admin.addSubnet")}
              </Button>
              {/* Same weight as its neighbour; the red icon alone marks the action as destructive */}
              <Button
                ref={removeNet}
                type="button"
                variant="ghost"
                size="xs"
                className={ui.MUTED_BTN}
                onClick={() => ctx.setMode("remove")}
              >
                <Trash2 className={cn(ui.ICON_META, ui.DANGER_ICON)} />
                {t("admin.removeNet")}
              </Button>
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
          <NetConfirm node={node} ctx={ctx} mode={mode} backTo={backTo} />
        </>
      )}
    </Frame>
  );
}
