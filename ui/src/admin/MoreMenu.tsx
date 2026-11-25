import { MoreHorizontal } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { NS } from "../i18n";
import * as ui from "../ui";

export interface MenuItem {
  label: string;
  icon: ReactNode;
  action: () => void;
}

// Templates, import, export and removing the plan are rare, so they sit behind [⋯]
export function MoreMenu({
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
