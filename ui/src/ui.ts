// Every class string the remote uses. The remote ships no CSS, so only classes in rmui's own Tailwind build
// work: no dark-mode variants (rmui never sets the dark class), and none of the theme colours that render
// orange besides primary.
// Active, on and selected styling is chosen in JS.

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring";
// Inside an overflow-hidden card an outer ring would be clipped, so controls there draw an inset border
const FOCUS_IN =
  "outline-none border-2 border-transparent focus-visible:border-ring";
// Busy controls use aria-disabled so they keep keyboard focus; disabled stays for inert ones
const DISABLED =
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:opacity-50";
// Grows a small control's hit area to 40 px or more without changing its look. An absolutely positioned
// control already anchors its ::after, so it takes HIT_AREA alone: adding relative would override absolute.
const HIT_AREA = "after:absolute after:-inset-2";
const HIT = `relative ${HIT_AREA}`;

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

export const PAGE = "mx-auto max-w-4xl space-y-6 p-4 md:p-6";
export const H1 = "text-2xl font-bold";

export const BTN = `inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium ${DISABLED} ${FOCUS}`;
export const BTN_PRIMARY_V =
  "bg-primary text-primary-foreground hover:bg-primary/90";
export const BTN_OUTLINE_V = "border border-input hover:bg-muted";
export const BTN_SM = `inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm ${DISABLED} ${FOCUS}`;
export const SM_PRIMARY =
  "bg-primary font-medium text-primary-foreground hover:bg-primary/90";
export const SM_INERT =
  "inline-flex h-10 shrink-0 cursor-not-allowed items-center justify-center rounded-md bg-muted px-3 text-sm text-muted-foreground";
export const SM_GHOST = "hover:bg-muted";
export const SM_DANGER =
  "bg-destructive font-medium text-white hover:bg-destructive/90";
export const LINK_BTN = `inline-flex h-10 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-muted ${DISABLED} ${FOCUS}`;
export const LINK_MUTED = "text-muted-foreground hover:text-foreground";
// Same weight as its neighbours; the red icon alone marks the action as destructive
export const LINK_DANGER = LINK_MUTED;
export const LINK_DANGER_ICON = "text-destructive";
export const ICON_BTN = `inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50 hover:text-foreground ${FOCUS}`;
export const ICON_BTN_GHOST = `inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS}`;
export const LOADER = "size-4 shrink-0 animate-spin";

// text-base below md keeps iOS from zooming into the field
export const INPUT_SM =
  "h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-base placeholder:text-muted-foreground sm:max-w-sm md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// The right padding makes room for the clear button only while there is text to clear
export const SEARCH_INPUT =
  "h-11 w-full min-w-0 truncate rounded-md border border-input bg-transparent pl-9 text-base placeholder:text-muted-foreground md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const SEARCH_EMPTY = "pr-2";
export const SEARCH_FILLED = "pr-8";

export const DOT_ON = "size-2 shrink-0 rounded-full bg-green-500";
export const DOT_OFF =
  "size-2 shrink-0 rounded-full border border-muted-foreground/40";
export const DOT_UNKNOWN =
  "size-2 shrink-0 rounded-full bg-muted-foreground opacity-50";
export const DOT_RED = "size-2 shrink-0 rounded-full bg-red-500";

export const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 px-3 text-xs";
export const CHIP_X =
  "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-border/50 bg-muted/50 pl-3 text-xs";
// A long callsign shortens inside its chip rather than pushing the chip's x off a phone screen
export const CHIP_TEXT = "truncate";
export const CHIP_X_BTN = `${HIT} inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${DISABLED} ${FOCUS}`;
export const CHIP_ADD = `${HIT} inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-input px-3 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground ${FOCUS}`;
export const CHIP_PICK = `${HIT} inline-flex h-8 items-center gap-1.5 rounded-full border bg-muted/50 px-3 text-xs hover:bg-muted ${DISABLED} ${FOCUS}`;
export const CHIP_PICK_FIRST = "border-primary";
export const CHIP_PICK_REST = "border-border/50";
// A suggestion in the picker listbox; clicked with the pointer, chosen with the arrow keys from the input
export const OPTION = "cursor-pointer";
export const CHIP_DIM = "opacity-50";
export const NET_TAG =
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs";
export const MUTED_XS = "text-xs text-muted-foreground";

export const HEADING =
  "flex items-center justify-between gap-2 pb-2 pl-2 pr-3 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground";
export const NUM = "tabular-nums";
export const HEAD_ONLINE =
  "inline-flex w-10 shrink-0 items-center justify-center gap-1 tabular-nums text-green-600";

export const TABLIST =
  "inline-flex h-11 w-full shrink-0 items-center rounded-lg bg-muted p-px md:w-auto";
export const TAB = `inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${FOCUS}`;
export const TAB_ON = "bg-background text-foreground shadow-sm";
export const TAB_OFF = "text-muted-foreground hover:text-foreground";
export const TAB_COUNT = "inline-flex items-center gap-1 text-xs tabular-nums";
export const TOOLBAR = "flex flex-col gap-2 md:flex-row";
export const TOOLBAR_RIGHT = "flex min-w-0 flex-1 items-center gap-1.5";
export const SEARCH_WRAP = "relative min-w-0 flex-1";
export const SEARCH_ICON =
  "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground";
export const SEARCH_CLEAR = `${HIT_AREA} absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground ${FOCUS}`;
export const MENU_WRAP = "relative";
export const MENU =
  "absolute right-0 top-full z-50 mt-1 w-64 rounded-md border bg-popover p-1 text-popover-foreground shadow-md";
export const MENU_ITEM = `flex h-10 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted ${FOCUS}`;

export const NOTICE =
  "flex items-start gap-2 rounded-md border px-3 py-2 text-sm";
// Small red text on the dark theme is under 4.5:1, so the words stay foreground and the icon carries the red
export const NOTICE_ERR =
  "border-destructive/20 bg-destructive/10 text-foreground";
export const NOTICE_ICON_ERR = "text-destructive";
export const NOTICE_OK = "border-green-500/20 bg-green-500/10 text-green-600";
export const NOTICE_ICON = "mt-0.5 size-4 shrink-0";
export const NOTICE_TEXT = "min-w-0 flex-1 break-words";
export const NOTICE_X = `${HIT} inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-muted ${FOCUS}`;

export const LEGEND =
  "flex flex-wrap items-center gap-3 px-2 pb-2 text-xs text-muted-foreground md:hidden";
export const LEGEND_ITEM = "inline-flex items-center gap-1";

// The net list: every top-level net is a card, its sub-nets are rows inside it. Opening a net never changes
// the list; the details show beside it (SIDE) on a wide workspace, or as the net's own screen (VIEW).
export const NETS_SPLIT = "flex items-start gap-4";
export const NETS_LIST = "min-w-0 flex-1";
export const CARDS = "space-y-2";
export const CARD = "overflow-hidden rounded-lg border border-border bg-card";
export const CARD_FORM = "rounded-lg border border-dashed border-input p-2";
export const SEP = "border-t border-border";
export const ROW = "relative flex h-11 items-stretch";
// Sub-net rows shrink to 40 px from md up; headers and missions stay 44 px
export const ROW_SUB = "md:h-auto";
export const ROW_IDLE = "hover:bg-muted/50";
export const ROW_ON = "bg-muted";
export const SEL_BAR =
  "pointer-events-none absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-foreground";
export const ROW_CONTEXT = "opacity-50";
export const CHEVRON = `flex w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS_IN}`;
export const CHEVRON_SVG = "size-4 transition-transform";
export const CHEVRON_OPEN = "rotate-90";
export const INDENT = "w-4 shrink-0";
export const LEAD_WRAP = "flex shrink-0";
export const LEAD = "flex w-8 shrink-0 items-center justify-center";
export const ROW_MAIN = `flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pr-2 text-left text-sm ${FOCUS_IN}`;
// Truncates only after the description has shrunk away, so the access and online columns stay visible
export const NAME = "min-w-0 truncate font-semibold";
export const NAME_SUB = "min-w-0 truncate font-medium";
export const DESC = "min-w-0 flex-1 truncate text-muted-foreground";
export const META = "flex shrink-0 items-center gap-2 text-xs tabular-nums";
export const FOLDED = "hidden text-muted-foreground md:inline";
export const ACC_MEMBERS = "inline-flex items-center gap-1 text-foreground";
export const ACC_FOLLOWS =
  "inline-flex items-center gap-1 text-muted-foreground";
export const ACC_WORD = "hidden md:inline";
export const CELL_ONLINE =
  "inline-flex w-10 shrink-0 items-center justify-center gap-1 text-green-600";
export const ICON_META = "size-3.5 shrink-0";
export const ICON = "size-4 shrink-0";
export const FLAG = "size-3.5 shrink-0 text-muted-foreground";

// The open net's details: a sticky panel beside the list, capped at the visible height of rmui's <main>
export const SIDE =
  "sticky top-4 w-80 shrink-0 self-start space-y-3 overflow-y-auto rounded-lg border border-border bg-card p-4 text-sm";
export const SIDE_STYLE = { maxHeight: "calc(100dvh - 6rem)" } as const;
export const DETAIL_HEAD = "flex items-start gap-2";
export const DETAIL_TITLE = "min-w-0 flex-1 break-words outline-none";
export const TITLE_PATH = "block truncate text-xs text-muted-foreground";
export const TITLE_NAME = "block break-words text-base font-semibold";
// ...or the net's own screen on a narrow workspace, with a sticky bar holding back and the title
export const VIEW = "min-h-svh";
export const VIEW_BAR =
  "sticky top-0 z-10 flex h-14 items-center gap-1 border-b border-border bg-background";
// A secondary button in the phone's net bar, as large as the back button
export const BAR_BTN = `inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS}`;
export const BACK_BTN = `inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted ${FOCUS}`;
export const VIEW_TITLE = "min-w-0 flex-1 outline-none";
export const VIEW_NAME = "block truncate text-base font-semibold";
export const VIEW_INNER = "space-y-3 py-4 text-sm";
export const PANEL_DESC = "break-words text-muted-foreground";
export const DETAIL_BODY = "space-y-3";
export const DETAIL_SPLIT = "border-t border-border pt-3";
// Who may use the open net: a segmented radio group, styled like the tabs; each option is over 44 px tall
export const SEG =
  "inline-flex h-12 w-full items-center rounded-lg bg-muted p-px";
export const SEG_OPT = `inline-flex h-[calc(100%-1px)] min-w-0 grow items-center justify-center whitespace-nowrap rounded-md px-1.5 text-xs font-medium transition-colors ${DISABLED} ${FOCUS}`;
export const ACCESS_LINE =
  "flex items-start gap-1.5 text-xs text-muted-foreground";
export const ACCESS_ICON = "mt-0.5 size-3.5 shrink-0";
// gap-2 keeps the chip x's enlarged hit area off the neighbouring chip
export const CHIPS_ROW = "flex flex-wrap items-center gap-2";
export const INNET =
  "flex flex-wrap items-center gap-1.5 text-xs text-green-600";
export const INNET_WHO = "font-medium";
export const SUBNETS =
  "flex flex-wrap items-center gap-1 text-xs text-muted-foreground";
export const SUBNET_LINK = `${LINK_BTN} font-medium text-foreground`;
export const DETAIL_FOOT =
  "flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3";
// The footer's separator, around a form or confirmation that takes the footer's place
export const DETAIL_FOOT_BLOCK = "space-y-2 border-t border-border pt-3";
export const CONFIRM =
  "flex flex-wrap items-center gap-3 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-sm";
// The details are narrow at every size, so the sentence always takes the full width, buttons below it
export const CONFIRM_TEXT = "min-w-0 basis-full text-foreground";
export const CONFIRM_CANCEL = "ml-auto";
// Cancel and the confirming button wrap together, on the right, under any extra button
export const CONFIRM_BTNS = "ml-auto flex items-center gap-3";
// Editing the open net's name and description
export const EDIT = "space-y-3";
export const FIELD = "block space-y-1";
export const FIELD_LABEL = "block text-xs text-muted-foreground";
export const TEXTAREA =
  "min-h-16 w-full resize-y field-sizing-content rounded-md border border-input bg-transparent px-2 py-1.5 text-base placeholder:text-muted-foreground md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
export const FORM_BTNS = "flex items-center gap-2";
// The template chooser at the top of the net list
export const PLAN = "space-y-2";
export const PLAN_HEAD = "flex items-center gap-2";
export const PLAN_TITLE =
  "min-w-0 flex-1 pl-1 text-sm font-semibold outline-none";
export const PLAN_NOTE = "px-1 text-xs text-muted-foreground";
export const PLAN_ITEM =
  "flex flex-wrap items-center gap-2 border-t border-border p-1 pt-2";
export const PLAN_TEXT = "min-w-0 flex-1";
export const PLAN_NAME = "block text-sm font-medium";
export const PLAN_DESC = "block text-xs text-muted-foreground";
export const PICKER = "space-y-2";
export const PICKER_ROW = "flex items-center gap-2";
export const FORM = "flex items-center gap-2";

export const USER_LIST = "pt-2";
export const USER_HEAD = "flex text-xs text-muted-foreground";
export const USER_HEAD_NOTE = "pl-2";
export const USER_HEAD_VOICE = "ml-auto w-12 text-center";
export const USER_ROW =
  "flex items-center gap-3 rounded-md pl-2 text-sm hover:bg-muted/50";
export const USER_CALLSIGN = "w-32 shrink-0 truncate font-medium";
export const USER_WHERE =
  "min-w-0 flex-1 truncate text-xs text-muted-foreground";
// Foreground words for contrast; the red dot in front carries the warning, as in the status line
export const USER_WHERE_OFF =
  "flex min-w-0 flex-1 items-center gap-1.5 text-xs text-foreground";
export const SWITCH_BTN = `inline-flex h-10 shrink-0 items-center rounded-md px-2 ${DISABLED} ${FOCUS}`;
export const SWITCH_TRACK =
  "inline-flex h-[1.15rem] w-8 items-center rounded-full border border-transparent transition-colors";
export const SWITCH_TRACK_ON = "bg-primary";
export const SWITCH_TRACK_OFF = "bg-input";
export const SWITCH_THUMB =
  "block size-4 rounded-full transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0";
export const SWITCH_THUMB_ON = "bg-white";
export const SWITCH_THUMB_OFF = "bg-muted-foreground";

export const YOU = "space-y-1";
export const YOU_LINE = "flex flex-wrap items-center gap-2 text-sm";
export const YOU_STATUS = "inline-flex items-center gap-1.5";
export const YOU_OFF = "text-foreground";

export const EMPTY =
  "flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground";
export const EMPTY_BTNS = "flex flex-wrap justify-center gap-2";
export const NOMATCH = "py-12 text-center text-sm text-muted-foreground";
export const HIDDEN_INPUT = "hidden";
export const ADMIN_WRAP = "space-y-2";
export const SR = "sr-only";
