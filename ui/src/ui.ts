// The class strings of the remote's own markup; the controls in components/ui carry theirs. The remote ships
// no CSS, so only classes in rmui's own Tailwind build work: no dark-mode variants (rmui never sets the dark
// class), and none of the theme colours that render orange besides primary.
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

export const PAGE = "mx-auto max-w-4xl space-y-6 p-4 md:p-6";
export const PAGE_HEAD = "flex items-center justify-between gap-2";
export const H1 = "text-2xl font-bold";

// For a Button whose words or icon should stay in the background until hovered
export const MUTED_BTN = "text-muted-foreground hover:text-foreground";
export const DANGER_ICON = "text-destructive";
export const LOADER = "animate-spin";

export const INPUT_SM = "h-10 sm:max-w-sm";
// The right padding makes room for the clear button only while there is text to clear
export const SEARCH_INPUT = "h-11 truncate pl-9";
export const SEARCH_EMPTY = "pr-2";
export const SEARCH_FILLED = "pr-8";

// A long callsign shortens inside its chip rather than pushing the chip's x off a phone screen
export const CHIP_TEXT = "truncate";
export const CHIP_X_BTN = `${HIT} inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground ${DISABLED} ${FOCUS}`;
export const CHIP_ADD = `${HIT} inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-input px-3 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground ${FOCUS}`;
export const NET_TAG =
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs";
export const MUTED_XS = "text-xs text-muted-foreground";

export const HEADING =
  "flex items-center justify-between gap-2 pb-2 pl-2 pr-3 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground";
export const NUM = "tabular-nums";
export const HEAD_ONLINE =
  "inline-flex w-10 shrink-0 items-center justify-center gap-1 tabular-nums text-green-600";

export const TABLIST = "h-11 w-full shrink-0 p-px md:w-auto";
export const TAB = "px-3";
export const TAB_ON = "bg-background text-foreground shadow-sm";
export const TAB_OFF = "text-muted-foreground hover:text-foreground";
export const TAB_COUNT = "inline-flex items-center gap-1 text-xs tabular-nums";
export const TOOLBAR = "flex flex-col gap-2 md:flex-row";
export const TOOLBAR_RIGHT = "flex min-w-0 flex-1 items-center gap-1.5";
export const SEARCH_WRAP = "relative min-w-0 flex-1";
export const SEARCH_ICON =
  "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground";
export const SEARCH_CLEAR = `${HIT_AREA} absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground ${FOCUS}`;
export const MENU = "w-64";
export const MENU_ITEM = "min-h-11 cursor-pointer";

export const NOTICE_OK = "border-green-500/20 bg-green-500/10 text-green-600";
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
export const SUBNET_LINK = "text-foreground";
export const DETAIL_FOOT =
  "flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3";
// The footer's separator, around the sub-net form that takes the footer's place
export const DETAIL_FOOT_BLOCK = "space-y-2 border-t border-border pt-3";
// Editing the open net's name and description
export const EDIT = "space-y-3";
export const FIELD = "block space-y-1";
export const FIELD_LABEL = "block text-xs text-muted-foreground";
export const FORM_BTNS = "flex items-center justify-end gap-2";
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

export const YOU = "space-y-1";
export const YOU_LINE = "flex flex-wrap items-center gap-2 text-sm";
export const YOU_STATUS = "inline-flex items-center gap-1.5";
export const YOU_OFF = "text-foreground";

export const EMPTY =
  "flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground";
export const EMPTY_BTNS = "flex flex-wrap justify-center gap-2";
export const NOMATCH = "py-12 text-center text-sm text-muted-foreground";
export const HIDDEN_INPUT = "hidden";
export const SR = "sr-only";

// Talking in the browser: the panel above the admin tools
export const TALK = "space-y-3 rounded-lg border border-border bg-card p-4";
export const TALK_TITLE = "text-base font-semibold";
export const TALK_STATUS =
  "flex flex-wrap items-center justify-between gap-2 text-sm";
// The net picker: the joined net, and a list capped so it never covers the whole screen
export const NET_PICK = "w-full";
export const NET_LIST_STYLE = {
  maxHeight: "min(50vh, var(--radix-select-content-available-height))",
} as const;
export const NET_OPTION = "min-h-11";
export const TALK_DETAIL = "block text-xs text-muted-foreground";
export const TALK_KEY =
  "flex flex-wrap items-center gap-2 text-xs text-muted-foreground";
// The push-to-talk button: big enough for a thumb, unmistakable while it transmits
export const TALK_PTT = `flex w-full select-none flex-col items-center justify-center gap-1 rounded-xl border-2 text-base font-semibold transition-colors ${DISABLED} ${FOCUS}`;
export const TALK_PTT_OFF = "border-primary bg-primary/10 text-primary";
export const TALK_PTT_ON = "border-primary bg-primary text-primary-foreground";
export const TALK_PTT_ICON = "size-8";
// Stays at the bottom of the screen while a long list of people in the net scrolls under it
export const TALK_PTT_BAR = "sticky bottom-0 z-10 space-y-2 bg-card py-2";
// Keeps its line when nobody talks, so the button under a thumb never moves
export const TALK_SPEAKING =
  "flex min-h-4 items-center gap-1.5 text-xs text-green-600";

// The voice guide's dialog: the step's words, a progress bar and the buttons; it scrolls only on a tiny screen
export const GUIDE = "max-h-[90vh] overflow-y-auto sm:max-w-md";
export const GUIDE_HEAD = "flex items-start gap-2";
export const GUIDE_TITLES = "min-w-0 flex-1 space-y-2";
export const GUIDE_STEP = "font-semibold";
export const GUIDE_TEXT = "leading-relaxed";
export const GUIDE_BAR = "h-1.5 w-full overflow-hidden rounded-full bg-muted";
export const GUIDE_FILL = "h-full bg-primary transition-all";
export const GUIDE_BTNS = "flex gap-3";
export const GUIDE_BTN = "flex-1";
export const GUIDE_OFF =
  "w-full justify-start text-xs font-normal text-muted-foreground hover:text-foreground";
