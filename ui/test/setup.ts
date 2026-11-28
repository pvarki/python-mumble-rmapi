import { cleanup } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { afterEach, vi } from "vitest";

import { addTranslations } from "../src/i18n";

await i18next
  .use(initReactI18next)
  .init({ lng: "en", resources: {}, showSupportNotice: false });
await addTranslations(i18next);

// Between user events Testing Library lets the clock run only where it finds Jest's fake timers
Object.assign(globalThis, {
  jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
