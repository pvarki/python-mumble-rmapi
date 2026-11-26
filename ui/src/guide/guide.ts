import { read, write } from "@/lib/storage";

export interface GuideStep {
  id: string;
  title: string; // i18n key
  description: string; // i18n key
}

const step = (id: string): GuideStep => ({
  id,
  title: `guide.steps.${id}.title`,
  description: `guide.steps.${id}.description`,
});

export function guideSteps({
  voice,
  admin,
}: {
  voice: boolean;
  admin: boolean;
}): GuideStep[] {
  return [
    ...(voice ? ["intro", "join", "talk", "nets"] : []),
    ...(admin ? ["units", "fixed"] : []),
  ].map(step);
}

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
