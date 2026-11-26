import { useTranslation } from "react-i18next";

import { api } from "../api";
import { NS, RAW } from "../i18n";
import { Confirm } from "./Confirm";
import { memberKey } from "./MemberChips";
import { focusAfterRemove, type NetNode } from "./tree";
import type { Mode, ReturnTo, TreeCtx } from "./types";

export function NetConfirm({
  node,
  ctx,
  mode,
  backTo,
}: {
  node: NetNode;
  ctx: TreeCtx;
  mode: Mode;
  backTo: (where: ReturnTo) => void;
}) {
  const { t } = useTranslation(NS);
  const { channel } = node;
  const id = channel.id;

  if (typeof mode === "object" && "access" in mode) {
    const next = mode.access;
    return (
      <Confirm
        title={t("admin.confirmNarrow")}
        busy={ctx.pending.has(`acc:${id}`)}
        confirmLabel={t("admin.change")}
        onCancel={() => backTo({ choice: channel.access })}
        onConfirm={() =>
          void ctx.run(
            `acc:${id}`,
            () => api.editChannel(id, { access: next }),
            () => backTo({ choice: next }),
          )
        }
      />
    );
  }

  if (typeof mode === "object" && "last" in mode) {
    const { last } = mode;
    return (
      <Confirm
        title={
          node.rule.kind === "membersPlus"
            ? t("admin.lastMemberOnly", {
                callsign: last,
                count: node.rule.nets.length,
                nets: node.rule.nets.join(", "),
                ...RAW,
              })
            : t("admin.lastMemberNobody", { callsign: last, ...RAW })
        }
        busy={ctx.pending.has(memberKey(id, last))}
        onCancel={() => backTo({ chip: last })}
        onConfirm={() =>
          void ctx.run(
            memberKey(id, last),
            () => api.removeMember(id, last),
            () => backTo("member"),
          )
        }
      />
    );
  }

  if (mode !== "remove") return null;
  return (
    <Confirm
      title={
        node.descendants
          ? t("admin.confirmRemoveTree", {
              name: channel.name,
              count: node.descendants,
              ...RAW,
            })
          : t("admin.confirmRemove", { name: channel.name, ...RAW })
      }
      detail={node.subtreeOnline ? t("admin.movesOut") : undefined}
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
  );
}
