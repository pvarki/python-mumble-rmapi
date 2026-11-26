import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { NS } from "@/i18n";
import { cn } from "@/lib/utils";
import { memberKey } from "./MemberChips";
import { suggest, type NetNode } from "./tree";
import type { TreeCtx } from "./types";

export function MemberPicker({
  node,
  ctx,
  onClose,
}: {
  node: NetNode;
  ctx: TreeCtx;
  onClose: () => void;
}) {
  const { t } = useTranslation(NS);
  const [text, setText] = useState("");
  const [highlighted, setHighlighted] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const id = node.channel.id;
  const hits = suggest(ctx.users, node.channel.members, text);
  const typed = text.trim() !== "";

  // Like the name forms: the field empties at once, keeps focus for the next member, and gets the text back
  // only if the add fails
  const add = (callsign: string) => {
    const sent = text;
    setText("");
    input.current?.focus();
    void ctx
      .run(memberKey(id, callsign), () => api.addMember(id, callsign))
      .then((ok) => {
        if (!ok) setText((now) => (now === "" ? sent : now));
      });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <Command
          label={t("admin.callsign")}
          shouldFilter={false}
          loop
          value={highlighted}
          onValueChange={setHighlighted}
          className="bg-transparent sm:max-w-sm"
        >
          <CommandInput
            ref={input}
            autoFocus
            value={text}
            onValueChange={setText}
            placeholder={t("admin.callsign")}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              // Closes the picker only, not the net it sits in
              event.stopPropagation();
              onClose();
            }}
          />
          {hits.length > 0 && (
            <CommandList label={t("admin.suggestions")}>
              {hits.map((user) => (
                <CommandItem
                  key={user.callsign}
                  value={user.callsign}
                  disabled={ctx.pending.has(memberKey(id, user.callsign))}
                  className={cn(user.callsign === highlighted && "bg-muted")}
                  onSelect={() => add(user.callsign)}
                >
                  {user.online?.length ? (
                    <>
                      <StatusDot state="on" />
                      <span className="sr-only">{t("admin.isOnline")}</span>
                    </>
                  ) : null}
                  {user.callsign}
                </CommandItem>
              ))}
            </CommandList>
          )}
        </Command>
        <Button
          type="button"
          variant="muted"
          size="icon-lg"
          aria-label={t("admin.close")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      {typed && !hits.length && (
        <p className="text-xs text-muted-foreground" role="status">
          {t("admin.noCallsign")}
        </p>
      )}
      {node.channel.access !== "invite" && (
        <p className="text-xs text-muted-foreground">
          {t("admin.firstMember")}
        </p>
      )}
    </div>
  );
}
