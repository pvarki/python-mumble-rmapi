import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import {
  api,
  type Channel,
  type Mission,
  type Template,
  type User,
} from "../api";
import { NS, RAW } from "../i18n";
import {
  AlertCircle,
  CheckCircle,
  CornerLeftUp,
  Download,
  ListPlus,
  Lock,
  MoreHorizontal,
  Plus,
  Search,
  Trash,
  Upload,
  X,
} from "../icons";
import {
  deriveTree,
  foldedAncestor,
  keyExists,
  parentOf,
  type Derived,
} from "../paths";
import * as ui from "../ui";
import { MissionDetails, NetDetails } from "./Details";
import {
  InlineConfirm,
  MissionRow,
  NameForm,
  NetCard,
  adding,
} from "./NetTree";
import { TemplatePanel } from "./Templates";
import type { FocusTarget, Mode, Open, Run, TreeCtx } from "./types";
import { UsersList } from "./Users";

// How often presence, nets and missions are fetched again while the page is visible
const REFRESH_MS = 10_000;
const NOTICE_MS = 6_000;
// Larger plans start collapsed to the top level
const EXPAND_UP_TO = 30;
const TAB_KEY = "mumble.adminTab";
const FOLDS_KEY = "mumble.folds";
// The workspace width from which an open net shows beside the list instead of as its own screen
const WIDE_FROM = 760;

type Tab = "nets" | "users";
// What shows at the top of the net list: a new net's name, the template chooser, or removing the whole plan
type Top = "net" | "templates" | "clear" | null;

interface MenuItem {
  label: string;
  icon: ReactNode;
  action: () => void;
}
type TabIds = Record<Tab | "panel", string>;

interface Data {
  channels: Channel[];
  users: User[];
  missions: Mission[];
}

interface Notice {
  kind: "error" | "ok";
  text: string;
}

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === "users" ? "users" : "nets";
  } catch {
    return "nets";
  }
}

function saveTab(tab: Tab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // storage blocked: the tab is simply not remembered
  }
}

// The admin's fold choices by channel id, in this browser only; anything malformed is ignored
function readFolds(): Map<number, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}");
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      Object.values(raw).every((v) => typeof v === "boolean")
    ) {
      return new Map(
        Object.entries(raw as Record<string, boolean>).map(([id, open]) => [
          Number(id),
          open,
        ]),
      );
    }
  } catch {
    // storage blocked or not JSON: folds live in memory only
  }
  return new Map();
}

function saveFolds(folds: Map<number, boolean>) {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify(Object.fromEntries(folds)));
  } catch {
    // storage blocked: folds live in memory only
  }
}

// Whether the workspace (not the viewport: rmui's sidebar takes part of it) is wide enough for the side panel
function useWide(ref: RefObject<HTMLElement | null>, min: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= min),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, min]);
  return wide;
}

function download(yaml: string) {
  const url = URL.createObjectURL(
    new Blob([yaml], { type: "application/yaml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "voice-channels.yaml";
  link.click();
  URL.revokeObjectURL(url);
}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Templates, import, export and removing the plan are rare, so they sit behind [⋯]
function MoreMenu({
  trigger,
  items,
}: {
  trigger: RefObject<HTMLButtonElement>;
  items: MenuItem[];
}) {
  const { t } = useTranslation(NS);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, trigger]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  // Arrow keys, Home and End move between the items, as in any menu
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"),
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = {
      ArrowDown: (at + 1) % items.length,
      ArrowUp: (at - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next].focus();
  };

  return (
    <div
      ref={wrap}
      className={ui.MENU_WRAP}
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={ui.ICON_BTN}
        title={t("admin.more")}
        aria-label={t("admin.more")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className={ui.ICON} />
      </button>
      {open && (
        <div role="menu" className={ui.MENU} onKeyDown={onMenuKey}>
          {items.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              className={ui.MENU_ITEM}
              onClick={choose(item.action)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar({
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

function NoticeLine({
  notice,
  dismiss,
}: {
  notice: Notice;
  dismiss: () => void;
}) {
  const { t } = useTranslation(NS);
  const error = notice.kind === "error";
  const Icon = error ? AlertCircle : CheckCircle;
  return (
    <div
      role={error ? "alert" : "status"}
      className={ui.cx(ui.NOTICE, error ? ui.NOTICE_ERR : ui.NOTICE_OK)}
    >
      <Icon className={ui.cx(ui.NOTICE_ICON, error && ui.NOTICE_ICON_ERR)} />
      <p className={ui.NOTICE_TEXT}>{notice.text}</p>
      <button
        type="button"
        className={ui.NOTICE_X}
        aria-label={t("admin.dismiss")}
        onClick={dismiss}
      >
        <X className={ui.ICON} />
      </button>
    </div>
  );
}

function GroupHeading({
  label,
  count,
  online,
  known,
  testId,
}: {
  label: string;
  count: number;
  online: number;
  known: boolean;
  testId: string;
}) {
  const { t } = useTranslation(NS);
  return (
    <div className={ui.HEADING} data-testid={testId}>
      <span role="heading" aria-level={2}>
        {label} <span className={ui.NUM}>{count}</span>
      </span>
      {!known ? (
        <span>{t("admin.presenceUnknown")}</span>
      ) : online > 0 ? (
        <span className={ui.HEAD_ONLINE}>
          <span className={ui.DOT_ON} aria-hidden="true" />
          <span aria-hidden="true">{online}</span>
          <span className={ui.SR}>
            {t("admin.onlineCount", { count: online })}
          </span>
        </span>
      ) : null}
    </div>
  );
}

function PhoneLegend() {
  const { t } = useTranslation(NS);
  return (
    <div className={ui.LEGEND}>
      <span className={ui.LEGEND_ITEM}>
        <Lock className={ui.ICON_META} />
        {t("admin.legendMembers")}
      </span>
      <span className={ui.LEGEND_ITEM}>
        <CornerLeftUp className={ui.ICON_META} />
        {t("admin.legendFollows")}
      </span>
      <span>{t("admin.legendOpen")}</span>
    </div>
  );
}

function NetsTab({
  data,
  derived,
  ctx,
  query,
  top,
  onAddNet,
  onTemplates,
  fileInput,
  details,
}: {
  data: Data;
  derived: Derived;
  ctx: TreeCtx;
  query: string;
  // The new net's form, the template chooser or the plan's removal, above the cards
  top: ReactNode;
  onAddNet: () => void;
  // Null when no template is on offer
  onTemplates: (() => void) | null;
  fileInput: RefObject<HTMLInputElement | null>;
  details: ReactNode;
}) {
  const { t } = useTranslation(NS);
  // On a narrow workspace the open net is its own screen in place of the list
  if (!ctx.wide && details) return details;
  const q = query.trim();
  const empty = !data.channels.length && !q;
  const list =
    q && !derived.unitMatches && !derived.missionMatches ? (
      <p className={ui.NOMATCH}>{t("admin.noMatches", { q, ...RAW })}</p>
    ) : (
      <>
        {empty && !top ? (
          <div className={ui.EMPTY}>
            {t("admin.empty")}
            <div className={ui.EMPTY_BTNS}>
              {onTemplates && (
                <button
                  type="button"
                  className={ui.cx(ui.BTN, ui.BTN_PRIMARY_V)}
                  onClick={onTemplates}
                >
                  <ListPlus className={ui.ICON} />
                  {t("admin.emptyTemplate")}
                </button>
              )}
              <button
                type="button"
                className={ui.cx(
                  ui.BTN,
                  onTemplates ? ui.BTN_OUTLINE_V : ui.BTN_PRIMARY_V,
                )}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className={ui.ICON} />
                {t("admin.emptyImport")}
              </button>
              <button
                type="button"
                className={ui.cx(ui.BTN, ui.BTN_OUTLINE_V)}
                onClick={onAddNet}
              >
                <Plus className={ui.ICON} />
                {t("admin.addNet")}
              </button>
            </div>
          </div>
        ) : (
          (derived.unitMatches > 0 || top) && (
            <section>
              <GroupHeading
                label={t("admin.units")}
                count={derived.unitMatches}
                online={derived.unitsOnline}
                known={derived.presenceKnown}
                testId="units-heading"
              />
              {derived.unitMatches > 0 && <PhoneLegend />}
              <ul className={ui.CARDS}>
                {top && <li className={ui.CARD_FORM}>{top}</li>}
                {derived.roots.map((node) => (
                  <NetCard key={node.channel.id} node={node} ctx={ctx} />
                ))}
              </ul>
            </section>
          )
        )}
        {derived.missionMatches > 0 && (
          <section>
            <GroupHeading
              label={t("admin.missions")}
              count={derived.missionMatches}
              online={derived.missionsOnline}
              known={derived.presenceKnown}
              testId="missions-heading"
            />
            <ul className={ui.CARD}>
              {derived.missions
                .filter((m) => m.match)
                .map((node, index) => (
                  <MissionRow
                    key={node.mission.name}
                    node={node}
                    ctx={ctx}
                    first={index === 0}
                  />
                ))}
            </ul>
          </section>
        )}
      </>
    );
  // The split stays in place while nets open and close, so the list never remounts under the pointer
  return ctx.wide ? (
    <div className={ui.NETS_SPLIT}>
      <div className={ui.NETS_LIST}>{list}</div>
      {details}
    </div>
  ) : (
    list
  );
}

export function Admin() {
  const { t } = useTranslation(NS);
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<Tab>(readTab);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Open | null>(null);
  const [top, setTop] = useState<Top>(null);
  const topNow = useRef<Top>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [overrides, setOverrides] = useState<Map<number, boolean>>(readFolds);
  // The folds as last written, so a fold made while a sub-net add was in flight is not undone by it
  const folds = useRef(overrides);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  // Busy controls stay focusable, so a second press must be refused here rather than by the browser
  const inFlight = useRef(new Set<string>());
  // The row control asked to take focus, and the net whose title should; each consumed once
  const focusTarget = useRef<FocusTarget | null>(null);
  const titleFocus = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const wide = useWide(wrap, WIDE_FROM);
  const baseId = useId();
  const ids: TabIds = {
    nets: `${baseId}-nets`,
    users: `${baseId}-users`,
    panel: `${baseId}-panel`,
  };
  const detailsId = `${baseId}-details`;
  // The notice's auto-clear timer, and a counter so a slow older load never overwrites a newer one
  const held = useRef<{ timer?: number; seq: number }>({ seq: 0 });
  // What a poll needs from the latest render: the open net, the data it came from, and how to focus a row
  const latest = useRef<{
    open: Open | null;
    data: Data | null;
    focusNet: (key: string | null) => void;
  }>({ open: null, data: null, focusNet: () => undefined });

  const showNotice = useCallback((next: Notice | null) => {
    window.clearTimeout(held.current.timer);
    setNotice(next);
    if (next?.kind === "ok") {
      held.current.timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    }
  }, []);

  const fail = useCallback(
    (error: unknown) =>
      showNotice({
        kind: "error",
        text: t("admin.error", { message: messageOf(error), ...RAW }),
      }),
    [t, showNotice],
  );

  const load = useCallback(() => {
    const seq = ++held.current.seq;
    return Promise.all([api.channels(), api.users(), api.missions()]).then(
      ([channels, users, missions]) => {
        if (seq !== held.current.seq) return;
        // A net deleted elsewhere closes its details; focus inside them moves to its parent's row, else
        // to the first card
        const { open: current, data: before, focusNet } = latest.current;
        if (current && !keyExists(current.key, channels, missions)) {
          const details = document.getElementById(detailsId);
          if (details?.contains(document.activeElement)) {
            const parent =
              current.key.startsWith("u:") && before
                ? parentOf(before.channels, Number(current.key.slice(2)))
                : null;
            const target = parent || channels[0]?.id;
            focusNet(target ? `u:${target}` : null);
          }
        }
        setOpen((cur) =>
          cur && keyExists(cur.key, channels, missions) ? cur : null,
        );
        setData({ channels, users, missions });
      },
      fail,
    );
  }, [fail, detailsId]);

  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load();
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    const timers = held.current;
    return () => window.clearTimeout(timers.timer);
  }, []);

  // Templates come with the image and do not change while the page is open
  useEffect(() => {
    api.templates().then(setTemplates, fail);
  }, [fail]);

  const run: Run = useCallback(
    async (key, call, onOk) => {
      if (inFlight.current.has(key)) return false;
      inFlight.current.add(key);
      setPending((keys) => new Set(keys).add(key));
      try {
        const result = await call();
        setNotice((current) => (current?.kind === "error" ? null : current));
        onOk?.(result);
        await load();
        return true;
      } catch (error) {
        fail(error);
        return false;
      } finally {
        inFlight.current.delete(key);
        setPending((keys) => {
          const next = new Set(keys);
          next.delete(key);
          return next;
        });
      }
    },
    [load, fail],
  );

  const derived = useMemo(
    () => data && deriveTree(data.channels, data.users, data.missions, query),
    [data, query],
  );

  const searching = query.trim() !== "";
  const expandAll = (derived?.unitCount ?? 0) <= EXPAND_UP_TO;
  // While searching every matching card is shown unfolded, and the saved folds are left alone
  const isExpanded = (id: number) =>
    searching || (overrides.get(id) ?? expandAll);

  // Asks for focus on a net's row; a row hidden by a fold hands it to that card's chevron
  const focusNet = (key: string | null) => {
    focusTarget.current = null;
    if (key === null) return;
    const center = !wide;
    const fold =
      key.startsWith("u:") && derived
        ? foldedAncestor(Number(key.slice(2)), derived.byId, isExpanded)
        : null;
    focusTarget.current =
      fold === null
        ? { key, part: "row", center }
        : { key: `u:${fold}`, part: "fold", center };
  };

  useEffect(() => {
    latest.current = { open, data, focusNet };
    topNow.current = top;
  });

  const openNet = (key: string) => {
    setTop(null);
    focusTarget.current = null;
    // On a wide workspace the selected row toggles its details; focus stays on the row
    if (wide && open?.key === key) {
      setOpen(null);
      return;
    }
    titleFocus.current = key;
    setOpen({ key, mode: "view" });
  };

  const closeNet = (focusKey?: string | null) => {
    focusNet(focusKey === undefined ? (open?.key ?? null) : focusKey);
    setOpen(null);
  };

  const setExpanded = (id: number, expanded: boolean) => {
    // Ids that left the tree are pruned on every write
    const next = new Map(
      [...folds.current].filter(([known]) => derived?.byId.has(known)),
    ).set(id, expanded);
    folds.current = next;
    setOverrides(next);
    saveFolds(next);
  };

  // Panels and forms would take focus again when Verkot is shown, so they close with the tab
  const pickTab = (next: Tab) => {
    focusTarget.current = null;
    setTop(null);
    setOpen((current) => current && { ...current, mode: "view" });
    setTab(next);
    saveTab(next);
  };

  // A phone's net screen gives way to the results as soon as the query changes; focus stays in the field
  const search = (next: string) => {
    focusTarget.current = null;
    if (!wide) setOpen(null);
    setQuery(next);
  };

  // The search would hide the form behind 'Ei osumia' and filter out the new net, so it is cleared first
  const openTop = (next: Exclude<Top, null>) => {
    search("");
    setOpen(null);
    setTop(next);
  };

  const closeTop = (focus: RefObject<HTMLButtonElement | null>) => {
    setTop(null);
    focus.current?.focus();
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
        titleFocus.current = `u:${id}`;
        setOpen({ key: `u:${id}`, mode: "view" });
      },
    );

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((yaml) =>
        run(
          "import",
          () => api.importPlan(yaml),
          ({ created }) =>
            showNotice({
              kind: "ok",
              text: t("admin.imported", { count: created }),
            }),
        ),
      )
      .catch(fail)
      .finally(() => {
        input.value = "";
      });
  };

  const onExport = () => void api.exportPlan().then(download, fail);

  const applyTemplate = (template: Template) =>
    void run(
      `tpl:${template.id}`,
      () => api.applyTemplate(template.id),
      ({ created }) => {
        closeIfStill("templates");
        showNotice({
          kind: "ok",
          text: t("admin.applied", { count: created }),
        });
      },
    );

  const clearPlan = () =>
    void run("clear", api.clearChannels, ({ removed }) => {
      setOpen(null);
      closeIfStill("clear");
      showNotice({ kind: "ok", text: t("admin.cleared", { count: removed }) });
    });

  const menu: MenuItem[] = [
    ...(templates.length
      ? [
          {
            label: t("admin.useTemplate"),
            icon: <ListPlus className={ui.ICON} />,
            action: () => openTop("templates"),
          },
        ]
      : []),
    {
      label: t("admin.importPlan"),
      icon: <Upload className={ui.ICON} />,
      action: () => fileInput.current?.click(),
    },
    {
      label: t("admin.exportPlan"),
      icon: <Download className={ui.ICON} />,
      action: onExport,
    },
    ...(data?.channels.length
      ? [
          {
            label: t("admin.clearAll"),
            icon: <Trash className={ui.cx(ui.ICON, ui.LINK_DANGER_ICON)} />,
            action: () => openTop("clear"),
          },
        ]
      : []),
  ];

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
        hasNets={!!data?.channels.length}
        pending={pending}
        onApply={applyTemplate}
        onClose={() => closeTop(moreButton)}
      />
    ) : top === "clear" && derived ? (
      <InlineConfirm
        text={[
          t("admin.confirmClear", { count: derived.unitCount }),
          derived.roots.some((r) => r.subtreeOnline) && t("admin.movesOut"),
          t("admin.clearExportFirst"),
        ]
          .filter(Boolean)
          .join(" ")}
        busy={pending.has("clear")}
        confirmLabel={t("admin.removeAll")}
        extra={
          <button
            type="button"
            className={ui.cx(ui.BTN_SM, ui.SM_GHOST)}
            onClick={onExport}
          >
            <Download className={ui.ICON} />
            {t("admin.exportFirst")}
          </button>
        }
        onCancel={() => closeTop(moreButton)}
        onConfirm={clearPlan}
      />
    ) : null;

  const openId =
    open?.key.startsWith("u:") && derived ? Number(open.key.slice(2)) : null;
  const openUnit = openId === null ? undefined : derived?.byId.get(openId);
  const openMission = open?.key.startsWith("m:")
    ? derived?.missions.find((m) => m.mission.name === open.key.slice(2))
    : undefined;
  const tree: Omit<TreeCtx, "derived"> = {
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
      wide && openId !== null && derived
        ? foldedAncestor(openId, derived.byId, isExpanded)
        : null,
    takeFocus: (key, part) => {
      const target = focusTarget.current;
      if (target?.key !== key || target.part !== part) return null;
      focusTarget.current = null;
      return target;
    },
    takeTitleFocus: (key) => {
      if (titleFocus.current !== key) return false;
      titleFocus.current = null;
      return true;
    },
  };

  // While a net is open on Verkot, the one notice slot sits at the top of its details, where the action was
  const noticeLine = notice && (
    <NoticeLine notice={notice} dismiss={() => showNotice(null)} />
  );
  const detailsShown = tab === "nets" && (!!openUnit || !!openMission);
  const details =
    derived && open && openUnit ? (
      <NetDetails
        key={open.key}
        node={openUnit}
        ctx={{ ...tree, derived }}
        mode={open.mode}
        notice={noticeLine}
      />
    ) : derived && open && openMission ? (
      <MissionDetails
        key={open.key}
        node={openMission}
        ctx={{ ...tree, derived }}
        notice={noticeLine}
      />
    ) : null;

  return (
    <div ref={wrap} className={ui.ADMIN_WRAP}>
      <Toolbar
        tab={tab}
        pickTab={pickTab}
        ids={ids}
        derived={derived}
        users={data?.users ?? []}
        query={query}
        setQuery={search}
        addButton={addButton}
        onAddNet={() => openTop("net")}
        moreButton={moreButton}
        menu={menu}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".yaml,.yml"
        className={ui.HIDDEN_INPUT}
        onChange={onFile}
      />
      {!detailsShown && noticeLine}
      <div
        role="tabpanel"
        id={ids.panel}
        aria-labelledby={ids[tab]}
        // Esc that no inner field, picker or confirmation took closes the open net
        onKeyDown={(event) => {
          if (event.key === "Escape" && tab === "nets" && open) {
            event.stopPropagation();
            closeNet();
          }
        }}
      >
        {!data || !derived ? (
          <p className={ui.NOMATCH}>{t("admin.loading")}</p>
        ) : tab === "nets" ? (
          <NetsTab
            data={data}
            derived={derived}
            ctx={{ ...tree, derived }}
            query={query}
            top={topPanel}
            onAddNet={() => openTop("net")}
            onTemplates={templates.length ? () => openTop("templates") : null}
            fileInput={fileInput}
            details={details}
          />
        ) : (
          <UsersList
            users={data.users}
            query={query}
            known={derived.presenceKnown}
            run={run}
            pending={pending}
          />
        )}
      </div>
    </div>
  );
}
