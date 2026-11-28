import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type ChannelEdit } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NS } from "@/i18n";
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
      className="space-y-3"
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
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">
          {t("admin.netName")}
        </span>
        <Input
          autoFocus
          type="text"
          maxLength={100}
          className="h-10 sm:max-w-sm"
          aria-describedby={describedBy}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="block text-xs text-muted-foreground">
          {t("admin.description")}
        </span>
        <Textarea
          maxLength={1000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {warn && (
        <p id={warnId} className="text-xs text-muted-foreground">
          {t("admin.renameMovesOut")}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          {t("admin.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          aria-disabled={!ready || undefined}
          aria-describedby={describedBy}
        >
          {ctx.pending.has(key) && <Loader2 className="animate-spin" />}
          {t("admin.save")}
        </Button>
      </div>
    </form>
  );
}
