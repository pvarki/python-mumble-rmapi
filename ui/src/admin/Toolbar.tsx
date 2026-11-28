import { Plus, Search, X } from "lucide-react";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "@/api";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NS } from "@/i18n";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col gap-2 md:flex-row">
      <TabsList className="h-11 w-full shrink-0 p-px md:w-auto">
        {tabs.map(([id, label]) => (
          <TabsTrigger
            key={id}
            value={id}
            // Chosen in JS: rmui's CSS has no data-[state=inactive] variants
            className={cn(
              "px-3",
              tab !== id && "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {derived &&
              (id === "nets" ? (
                <span className="inline-flex items-center gap-1 text-xs tabular-nums">
                  {derived.unitCount + derived.missions.length}
                </span>
              ) : derived.presenceKnown ? (
                <span
                  className="inline-flex items-center gap-1 text-xs tabular-nums"
                  aria-label={t("admin.onlineOfTotal", {
                    online,
                    total: active.length,
                  })}
                >
                  <StatusDot state="on" />
                  {online}/{active.length}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs tabular-nums">
                  {active.length}
                </span>
              ))}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            enterKeyHint="search"
            className={cn("h-11 truncate pl-9", query ? "pr-8" : "pr-2")}
            value={query}
            placeholder={t("admin.search")}
            aria-label={t("admin.search")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {query && (
            <Button
              type="button"
              variant="muted"
              size="icon"
              // after:-inset-2 grows the hit area to 44 px
              className="absolute right-1 top-1/2 size-7 -translate-y-1/2 after:absolute after:-inset-2"
              aria-label={t("admin.clear")}
              onClick={() => setQuery("")}
            >
              <X />
            </Button>
          )}
        </div>
        {tab === "nets" && (
          <>
            <Button
              ref={addButton}
              type="button"
              variant="outline"
              size="icon-lg"
              className="text-muted-foreground hover:text-foreground"
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
