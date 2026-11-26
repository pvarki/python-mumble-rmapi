import type { TFunction } from "i18next";

import { RAW } from "@/i18n";
import type { Rule } from "./tree";

// The rule in one sentence, naming the nets that restrict it
export function ruleSentence(t: TFunction, rule: Rule): string {
  switch (rule.kind) {
    case "members":
      return t("admin.accessMembers");
    case "membersPlus":
      return t("admin.accessMembersPlus", {
        count: rule.nets.length,
        nets: rule.nets.join(", "),
        ...RAW,
      });
    case "follows":
      return t("admin.accessSameAs", { net: rule.net, ...RAW });
    case "open":
      return t("admin.accessOpen");
  }
}
