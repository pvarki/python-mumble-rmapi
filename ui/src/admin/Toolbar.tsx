import { Plus, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import { StatusDot } from "@/components/StatusDot";
import type { User } from "../api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { TabsList, TabsTrigger } from "../components/ui/tabs";
import { NS } from "../i18n";
import { cn } from "../lib/utils";
import * as ui from "../ui";
import { MoreMenu, type MenuItem } from "./MoreMenu";
import type { Derived } from "./tree";
import type { Tab } from "./types";

export function Toolbar({
  tab,
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
  const active = users.filter((u) => !u.revoked);
  const online = active.filter((u) => u.online?.length).length;
  const tabs: [Tab, string][] = [
    ["nets", t("admin.tabNets")],
    ["users", t("admin.tabUsers")],
  ];
  return (
    <div className={ui.TOOLBAR}>
      <TabsList className={ui.TABLIST}>
        {tabs.map(([id, label]) => (
          <TabsTrigger
            key={id}
            value={id}
            className={cn(ui.TAB, tab !== id && ui.TAB_OFF)}
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
                  <StatusDot state="on" />
                  {online}/{active.length}
                </span>
              ) : (
                <span className={ui.TAB_COUNT}>{active.length}</span>
              ))}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className={ui.TOOLBAR_RIGHT}>
        <div className={ui.SEARCH_WRAP}>
          <Search className={ui.SEARCH_ICON} />
          <Input
            type="text"
            enterKeyHint="search"
            className={cn(
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
            <Button
              ref={addButton}
              type="button"
              variant="outline"
              size="icon-lg"
              className={ui.MUTED_BTN}
              title={t("admin.addNet")}
              aria-label={t("admin.addNet")}
              onClick={onAddNet}
            >
              <Plus />
            </Button>
            <MoreMenu trigger={moreButton} items={menu} />
          </>
        )}
      </div>
    </div>
  );
}
