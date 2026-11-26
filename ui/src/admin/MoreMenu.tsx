import { MoreHorizontal } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
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
  // Not modal, as a modal menu holds focus while it fades out, so a panel opened from it could not take focus
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          size="icon-lg"
          className={ui.MUTED_BTN}
          title={t("admin.more")}
          aria-label={t("admin.more")}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        loop
        className={ui.MENU}
        onCloseAutoFocus={(event) => {
          // An item that opened a panel or a confirmation has moved focus there already
          const at = document.activeElement;
          if (at && at !== document.body) event.preventDefault();
        }}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className={ui.MENU_ITEM}
            onSelect={item.action}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
