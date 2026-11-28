import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { NS } from "@/i18n";
import { read, write } from "@/lib/storage";
import { ClearPlan } from "./ClearPlan";
import { useAdminData } from "./hooks/useAdminData";
import { useFocusRequests } from "./hooks/useFocusRequests";
import { useFolds } from "./hooks/useFolds";
import { useNotice } from "./hooks/useNotice";
import { usePlan } from "./hooks/usePlan";
import { useRun } from "./hooks/useRun";
import { useWide } from "./hooks/useWide";
import { MissionDetails } from "./MissionDetails";
import { NameForm, adding } from "./NameForm";
import { NetDetails } from "./NetDetails";
import { NetsTab } from "./NetsTab";
import { NoticeLine } from "./NoticeLine";
import { TemplatePanel } from "./TemplatePanel";
import { Toolbar } from "./Toolbar";
import { deriveTree, foldedAncestor, keyExists, parentOf } from "./tree";
import type { Data, Mode, Open, Tab, Top, TreeCtx } from "./types";
import { UsersList } from "./UsersList";

// The workspace width from which an open net shows beside the list instead of as its own screen
const WIDE_FROM = 760;
const TAB_KEY = "mumble.adminTab";

function readTab(): Tab {
  return read(TAB_KEY) === "users" ? "users" : "nets";
}

function saveTab(tab: Tab) {
  write(TAB_KEY, tab);
}

export function Admin() {
  const { t } = useTranslation(NS);
  const [tab, setTab] = useState<Tab>(readTab);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [top, setTop] = useState<Top>(null);
  const topNow = useRef<Top>(null);
  // The button that takes focus once the top panel has gone; a confirmation holds focus until then
  const focusAfterTop = useRef<RefObject<HTMLButtonElement | null> | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const wide = useWide(wrap, WIDE_FROM);
  const detailsId = useId();
  const { notice, showNotice, fail, clearError } = useNotice();
  const { data, templates, load } = useAdminData(fail, closeRemoved);
  const { run, pending } = useRun(load, fail, clearError);
  const focus = useFocusRequests();

  const derived = useMemo(
    () => data && deriveTree(data.channels, data.users, data.missions, query),
    [data, query],
  );

  const searching = query.trim() !== "";
  const { isExpanded, setExpanded } = useFolds(derived, searching);

  // Asks for focus on a net's row; a row hidden by a fold hands it to that card's chevron
  const focusNet = (key: string | null) => {
    if (key === null) {
      focus.askRow(null);
      return;
    }
    const center = !wide;
    const fold =
      key.startsWith("u:") && derived
        ? foldedAncestor(Number(key.slice(2)), derived.byId, isExpanded)
        : null;
    focus.askRow(
      fold === null
        ? { key, part: "row", center }
        : { key: `u:${fold}`, part: "fold", center },
    );
  };

  // A net deleted elsewhere closes its details; focus inside them moves to its parent's row, else to the
  // first card
  function closeRemoved({ channels, missions }: Data) {
    if (open && !keyExists(open.key, channels, missions)) {
      const details = document.getElementById(detailsId);
      if (details?.contains(document.activeElement)) {
        const parent =
          open.key.startsWith("u:") && data
            ? parentOf(data.channels, Number(open.key.slice(2)))
            : null;
        const target = parent || channels[0]?.id;
        focusNet(target ? `u:${target}` : null);
      }
    }
    setOpen((current) =>
      current && keyExists(current.key, channels, missions) ? current : null,
    );
  }

  useEffect(() => {
    topNow.current = top;
    if (top === null && focusAfterTop.current) {
      focusAfterTop.current.current?.focus();
      focusAfterTop.current = null;
    }
  });

  const openNet = (key: string) => {
    setTop(null);
    focus.askRow(null);
    // On a wide workspace the selected row toggles its details; focus stays on the row
    if (wide && open?.key === key) {
      setOpen(null);
      return;
    }
    focus.askTitle(key);
    setOpen({ key, mode: "view" });
  };

  const closeNet = (focusKey?: string | null) => {
    focusNet(focusKey === undefined ? (open?.key ?? null) : focusKey);
    setOpen(null);
  };

  // Panels and forms would take focus again when the Nets tab is shown, so they close with the tab
  const pickTab = (next: Tab) => {
    focus.askRow(null);
    setTop(null);
    setOpen((current) => current && { ...current, mode: "view" });
    setTab(next);
    saveTab(next);
  };

  // A phone's net screen gives way to the results as soon as the query changes; focus stays in the field
  const search = (next: string) => {
    focus.askRow(null);
    if (!wide) setOpen(null);
    setQuery(next);
  };

  // The search would hide the form behind the no-matches line and filter out the new net, so it is cleared first
  const openTop = (next: Exclude<Top, null>) => {
    search("");
    setOpen(null);
    setTop(next);
  };

  const closeTop = (button: RefObject<HTMLButtonElement | null>) => {
    focusAfterTop.current = button;
    setTop(null);
  };

  // A request's panel closes when it is done, unless something else has taken its place meanwhile
  const closeIfStill = (panel: Top) => {
    if (topNow.current === panel) closeTop(moreButton);
  };

  const addTopNet = (name: string) =>
    run(
      `add:0:${name}`,
      () => api.addChannel(name, 0),
      ({ id }) => {
        setTop(null);
        focus.askTitle(`u:${id}`);
        setOpen({ key: `u:${id}`, mode: "view" });
      },
    );

  const hasNets = !!data?.channels.length;
  const plan = usePlan({
    templates,
    hasNets,
    fileInput,
    run,
    showNotice,
    fail,
    openTop,
    closeIfStill,
    onCleared: () => setOpen(null),
  });

  const topPanel =
    top === "net" ? (
      <NameForm
        placeholder={t("admin.netName")}
        busy={adding(pending, 0)}
        onSubmit={addTopNet}
        onCancel={() => closeTop(addButton)}
      />
    ) : top === "templates" ? (
      <TemplatePanel
        templates={templates}
        hasNets={hasNets}
        pending={pending}
        onApply={plan.applyTemplate}
        onClose={() => closeTop(moreButton)}
      />
    ) : null;

  const openId =
    open?.key.startsWith("u:") && derived ? Number(open.key.slice(2)) : null;
  const openUnit = openId === null ? undefined : derived?.byId.get(openId);
  const openMission = open?.key.startsWith("m:")
    ? derived?.missions.find((m) => m.mission.name === open.key.slice(2))
    : undefined;
  const ctx: TreeCtx | null = derived && {
    derived,
    users: data?.users ?? [],
    open,
    wide,
    detailsId,
    openNet,
    closeNet,
    setMode: (mode: Mode) =>
      setOpen((current) => current && { ...current, mode }),
    run,
    pending,
    searching,
    isExpanded,
    setExpanded,
    // The open net hidden by a fold is marked on that card's header (wide only: a phone hides the list)
    markedFold:
      wide && openId !== null
        ? foldedAncestor(openId, derived.byId, isExpanded)
        : null,
    takeFocus: focus.takeFocus,
    takeTitleFocus: focus.takeTitleFocus,
  };

  // While a net is open on the Nets tab, the one notice slot sits at the top of its details, where the action was
  const noticeLine = notice && (
    <NoticeLine notice={notice} dismiss={() => showNotice(null)} />
  );
  const detailsShown = tab === "nets" && (!!openUnit || !!openMission);
  const details =
    ctx && open && openUnit ? (
      <NetDetails
        key={open.key}
        node={openUnit}
        ctx={ctx}
        mode={open.mode}
        notice={noticeLine}
      />
    ) : ctx && open && openMission ? (
      <MissionDetails
        key={open.key}
        node={openMission}
        ctx={ctx}
        notice={noticeLine}
      />
    ) : null;

  const loading = (
    <p className="py-12 text-center text-sm text-muted-foreground">
      {t("admin.loading")}
    </p>
  );

  return (
    <div ref={wrap}>
      <Tabs value={tab} onValueChange={(value) => pickTab(value as Tab)}>
        <Toolbar
          tab={tab}
          derived={derived}
          users={data?.users ?? []}
          query={query}
          setQuery={search}
          addButton={addButton}
          onAddNet={() => openTop("net")}
          moreButton={moreButton}
          menu={plan.menu}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".yaml,.yml"
          className="hidden"
          onChange={plan.onFile}
        />
        {top === "clear" && derived && (
          <ClearPlan
            derived={derived}
            busy={pending.has("clear")}
            onExport={plan.onExport}
            onClear={plan.clearPlan}
            onClose={() => closeTop(moreButton)}
          />
        )}
        {!detailsShown && noticeLine}
        <TabsContent
          value="nets"
          // Esc that no inner field, picker or confirmation took closes the open net
          onKeyDown={(event) => {
            if (event.key === "Escape" && open) {
              event.stopPropagation();
              closeNet();
            }
          }}
        >
          {data && ctx ? (
            <NetsTab
              data={data}
              ctx={ctx}
              query={query}
              top={topPanel}
              onAddNet={() => openTop("net")}
              onTemplates={templates.length ? () => openTop("templates") : null}
              fileInput={fileInput}
              details={details}
            />
          ) : (
            loading
          )}
        </TabsContent>
        <TabsContent value="users">
          {data && derived ? (
            <UsersList
              users={data.users}
              query={query}
              known={derived.presenceKnown}
              run={run}
              pending={pending}
            />
          ) : (
            loading
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
