import { Plus, Search, X } from "lucide-react";
import { useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "../api";
import { NS } from "../i18n";
import * as ui from "../ui";
import { MoreMenu, type MenuItem } from "./MoreMenu";
import type { Derived } from "./tree";
import type { Tab } from "./types";

export type TabIds = Record<Tab | "panel", string>;

export function Toolbar({
  tab,
  pickTab,
  ids,
  derived,
  users,
  query,
  setQuery,
  addButton,
  onAddNet,
  moreButton,
  menu,
}: {
  tab: Tab;
  pickTab: (tab: Tab) => void;
  ids: TabIds;
  derived: Derived | null;
  users: User[];
  query: string;
  setQuery: (query: string) => void;
  addButton: RefObject<HTMLButtonElement>;
  onAddNet: () => void;
  moreButton: RefObject<HTMLButtonElement>;
  menu: MenuItem[];
}) {
  const { t } = useTranslation(NS);
  const tabButtons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const active = users.filter((u) => !u.revoked);
  const online = active.filter((u) => u.online?.length).length;
  const tabs: [Tab, string][] = [
    ["nets", t("admin.tabNets")],
    ["users", t("admin.tabUsers")],
  ];
  return (
    <div className={ui.TOOLBAR}>
      <div
        role="tablist"
        className={ui.TABLIST}
        onKeyDown={(event) => {
          const other: Tab = tab === "nets" ? "users" : "nets";
          const next = (
            {
              ArrowLeft: other,
              ArrowRight: other,
              Home: "nets",
              End: "users",
            } as Record<string, Tab>
          )[event.key];
          if (!next) return;
          event.preventDefault();
          pickTab(next);
          tabButtons.current[next]?.focus();
        }}
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            ref={(button) => {
              tabButtons.current[id] = button;
            }}
            id={ids[id]}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={ids.panel}
            tabIndex={tab === id ? 0 : -1}
            className={ui.cx(ui.TAB, tab === id ? ui.TAB_ON : ui.TAB_OFF)}
            onClick={() => pickTab(id)}
          >
            {label}
            {derived &&
              (id === "nets" ? (
                <span className={ui.TAB_COUNT}>
                  {derived.unitCount + derived.missions.length}
                </span>
              ) : derived.presenceKnown ? (
                <span
                  className={ui.TAB_COUNT}
                  aria-label={t("admin.onlineOfTotal", {
                    online,
                    total: active.length,
                  })}
                >
                  <span className={ui.DOT_ON} />
                  {online}/{active.length}
                </span>
              ) : (
                <span className={ui.TAB_COUNT}>{active.length}</span>
              ))}
          </button>
        ))}
      </div>
      <div className={ui.TOOLBAR_RIGHT}>
        <div className={ui.SEARCH_WRAP}>
          <Search className={ui.SEARCH_ICON} />
          <input
            type="text"
            enterKeyHint="search"
            className={ui.cx(
              ui.SEARCH_INPUT,
              query ? ui.SEARCH_FILLED : ui.SEARCH_EMPTY,
            )}
            value={query}
            placeholder={t("admin.search")}
            aria-label={t("admin.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {query && (
            <button
              type="button"
              className={ui.SEARCH_CLEAR}
              aria-label={t("admin.clear")}
              onClick={() => setQuery("")}
            >
              <X className={ui.ICON} />
            </button>
          )}
        </div>
        {tab === "nets" && (
          <>
            <button
              ref={addButton}
              type="button"
              className={ui.ICON_BTN}
              title={t("admin.addNet")}
              aria-label={t("admin.addNet")}
              onClick={onAddNet}
            >
              <Plus className={ui.ICON} />
            </button>
            <MoreMenu trigger={moreButton} items={menu} />
          </>
        )}
      </div>
    </div>
  );
}
