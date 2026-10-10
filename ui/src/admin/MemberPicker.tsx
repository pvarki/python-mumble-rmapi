import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "../api";
import { NS } from "../i18n";
import { X } from "../icons";
import { suggest, type NetNode } from "../paths";
import * as ui from "../ui";
import type { TreeCtx } from "./types";

// Type-to-filter suggestions instead of a 150-option select, as an ARIA combobox: focus stays in the input,
// arrow keys move the highlighted suggestion, Enter adds it, and the input keeps focus for the next member.
// The first Esc only hides the suggestions, keeping the text; the next one closes the picker.
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
  const [active, setActive] = useState(0);
  // Esc hid the suggestions; typing or ArrowDown shows them again
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const id = node.channel.id;
  const hits = suggest(ctx.users, node.channel.members, text);
  const keyOf = (callsign: string) => `mem:${id}:${callsign}`;
  const typed = text.trim() !== "";
  const expanded = typed && hits.length > 0 && !dismissed;
  const current = expanded ? Math.min(active, hits.length - 1) : -1;
  const optionId = (index: number) => `${listId}-${index}`;

  // Like the name forms: the field empties at once and gets the text back only if the add fails
  const add = (callsign: string) => {
    const sent = text;
    setText("");
    setActive(0);
    input.current?.focus();
    void ctx
      .run(keyOf(callsign), () => api.addMember(id, callsign))
      .then((ok) => {
        if (!ok) setText((now) => (now === "" ? sent : now));
      });
  };
  const move = (step: number) =>
    setActive((current + step + hits.length) % hits.length);

  return (
    <div className={ui.PICKER}>
      <div className={ui.PICKER_ROW}>
        <input
          ref={input}
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          className={ui.INPUT_SM}
          value={text}
          placeholder={t("admin.callsign")}
          aria-label={t("admin.callsign")}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setDismissed(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && dismissed) {
              event.preventDefault();
              setDismissed(false);
            } else if (event.key === "ArrowDown" && expanded) {
              event.preventDefault();
              move(1);
            } else if (event.key === "ArrowUp" && expanded) {
              event.preventDefault();
              move(-1);
            } else if (event.key === "Enter" && current >= 0) {
              event.preventDefault();
              add(hits[current].callsign);
            } else if (event.key === "Escape") {
              event.stopPropagation();
              if (expanded) setDismissed(true);
              else onClose();
            }
          }}
        />
        <button
          type="button"
          className={ui.ICON_BTN_GHOST}
          aria-label={t("admin.close")}
          onClick={onClose}
        >
          <X className={ui.ICON} />
        </button>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={t("admin.suggestions")}
        className={expanded ? ui.CHIPS_ROW : ui.SR}
        data-testid="suggestions"
      >
        {expanded &&
          hits.map((user, index) => (
            <li
              key={user.callsign}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              aria-disabled={ctx.pending.has(keyOf(user.callsign)) || undefined}
              className={ui.cx(
                ui.CHIP_PICK,
                index === current ? ui.CHIP_PICK_FIRST : ui.CHIP_PICK_REST,
                ui.OPTION,
              )}
              // Keep focus in the input, so typing and Enter carry on after a click
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => add(user.callsign)}
            >
              {user.online?.length ? (
                <>
                  <span className={ui.DOT_ON} />
                  <span className={ui.SR}>{t("admin.isOnline")}</span>
                </>
              ) : null}
              {user.callsign}
            </li>
          ))}
      </ul>
      {typed && !hits.length && (
        <p className={ui.MUTED_XS} role="status">
          {t("admin.noCallsign")}
        </p>
      )}
      {node.channel.access !== "invite" && (
        <p className={ui.MUTED_XS}>{t("admin.firstMember")}</p>
      )}
    </div>
  );
}
