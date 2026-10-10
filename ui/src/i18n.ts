import type { i18n as I18n } from "i18next";

import en from "./locales/en.json";
import fi from "./locales/fi.json";
import sv from "./locales/sv.json";

// The remote shares rmui's i18next instance and keeps its strings in their own namespace.
export const NS = "mumble";

export async function addTranslations(i18n: I18n): Promise<void> {
  i18n.addResourceBundle("en", NS, en, true, true);
  i18n.addResourceBundle("fi", NS, fi, true, true);
  i18n.addResourceBundle("sv", NS, sv, true, true);
  await i18n.loadNamespaces(NS);
}

// React escapes text itself; i18next's own HTML escaping would show names, callsigns and server messages
// with entities such as &quot;.
export const RAW = { interpolation: { escapeValue: false } } as const;
