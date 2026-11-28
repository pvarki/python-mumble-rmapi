import { read, write } from "@/lib/storage";

export interface GuideStep {
  id: string;
  title: string; // i18n key
  description: string; // i18n key
  // i18n keys of the step's picture, a file in public/guide, and its alt text
  image?: { file: string; alt: string };
}

// Where someone talks: here in the browser, or in ATAK with OD Voice
export const PLATFORMS = ["browser", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

// vite.config.ts serves public/ under its base, /ui/mumble/
export const GUIDE_FILES = "/ui/mumble/guide/";

const step = (id: string, pictured = false): GuideStep => ({
  id,
  title: `guide.steps.${id}.title`,
  description: `guide.steps.${id}.description`,
  ...(pictured && {
    image: {
      file: `guide.steps.${id}.image`,
      alt: `guide.steps.${id}.alt`,
    },
  }),
});

const TALK: Record<Platform, GuideStep[]> = {
  browser: [step("join"), step("talk", true)],
  android: [step("plugin", true), step("ptt", true)],
};

export function guideSteps({
  voice,
  admin,
  platform = "browser",
}: {
  voice: boolean;
  admin: boolean;
  platform?: Platform;
}): GuideStep[] {
  return [
    ...(voice ? [step("intro"), ...TALK[platform], step("nets")] : []),
    ...(admin ? [step("units"), step("fixed")] : []),
  ];
}

// The platform the guide starts on: ATAK on Android, the browser anywhere else
export const detectPlatform = (userAgent = navigator.userAgent): Platform =>
  /android/i.test(userAgent) ? "android" : "browser";

// Per callsign, as people may share a browser
const key = (callsign: string) => `mumble.guide.${callsign}`;

// The steps this callsign has seen the guide through to its end in this browser
export function finishedSteps(callsign: string): string[] {
  try {
    return JSON.parse(read(key(callsign)) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function saveFinished(
  callsign: string,
  steps: readonly GuideStep[],
): void {
  const ids = new Set([...finishedSteps(callsign), ...steps.map((s) => s.id)]);
  write(key(callsign), JSON.stringify([...ids]));
}

// Opens by itself, where rmui allows it, when a step is new to this callsign, as for a new admin. Without a
// callsign there is nothing to remember it by.
export function opensItself(
  callsign: string | undefined,
  steps: readonly GuideStep[],
  autoOpenGuides: boolean | undefined,
): boolean {
  if (!callsign || autoOpenGuides === false) return false;
  const finished = finishedSteps(callsign);
  return steps.some((s) => !finished.includes(s.id));
}
