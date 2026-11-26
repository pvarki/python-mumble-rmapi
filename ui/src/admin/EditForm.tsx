import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type ChannelEdit } from "../api";
import { NS } from "../i18n";
import { Loader } from "../icons";
import * as ui from "../ui";
import type { NetNode } from "./tree";
import type { TreeCtx } from "./types";

// The open net's name and description; Enter in the name saves, Esc cancels
export function EditForm({
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
